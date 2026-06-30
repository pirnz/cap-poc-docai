const cds = require('@sap/cds');
const { parseDocumentResult } = require('./utils/docai-parser');
const { normalizePayload, validatePayload } = require('./utils/payload-normalizer');
const { simpleParser } = require('mailparser');
const AdmZip = require('adm-zip');
const FormData = require('form-data');
const { executeHttpRequest } = require('@sap-cloud-sdk/http-client');

module.exports = cds.service.impl(async function() {
  const { ProcessingBatches, Documents, InvoiceHeader, InvoiceLineItems, ValidationResults } = this.entities;

  /**
   * Calculate criticality for UI
   * @param {Number} confidence - Confidence score (0-1)
   * @returns {Integer} Criticality (1=Red, 2=Yellow, 3=Green)
   */
  function calculateCriticality(confidence) {
    if (confidence >= 0.85) return 3; // Green
    if (confidence >= 0.70) return 2; // Yellow
    return 1; // Red
  }

  /**
   * Calculate status criticality
   * @param {String} status - Status string
   * @returns {Integer} Criticality
   */
  function calculateStatusCriticality(status) {
    switch (status) {
      case 'completed':
      case 'validated':
        return 3; // Green
      case 'processing':
      case 'extracted':
        return 2; // Yellow
      case 'failed':
        return 1; // Red
      default:
        return 0; // Neutral
    }
  }

  /**
   * After READ handler - add criticality to ProcessingBatches
   */
  this.after('READ', 'ProcessingBatches', (batches) => {
    const batchesArray = Array.isArray(batches) ? batches : [batches];
    batchesArray.forEach(batch => {
      if (batch) {
        batch.statusCriticality = calculateStatusCriticality(batch.status);
      }
    });
  });

  /**
   * After READ handler - add criticality to Documents
   */
  this.after('READ', 'Documents', (documents) => {
    const docsArray = Array.isArray(documents) ? documents : [documents];
    docsArray.forEach(doc => {
      if (doc) {
        doc.statusCriticality = calculateStatusCriticality(doc.status);
      }
    });
  });

  /**
   * After READ handler - add criticality to InvoiceHeaders
   */
  this.after('READ', 'InvoiceHeaders', (headers) => {
    const headersArray = Array.isArray(headers) ? headers : [headers];
    headersArray.forEach(header => {
      if (header) {
        header.invoiceNumber_criticality = calculateCriticality(header.invoiceNumber_confidence || 0);
        header.supplier_criticality = calculateCriticality(header.supplier_confidence || 0);
        header.amount_criticality = calculateCriticality(header.amount_confidence || 0);
        header.invoiceDate_criticality = calculateCriticality(header.invoiceDate_confidence || 0);
        header.poNumber_criticality = calculateCriticality(header.poNumber_confidence || 0);
        header.overallConfidence_criticality = calculateCriticality(header.overallConfidence || 0);
      }
    });
  });

  /**
   * After READ handler - add criticality to ValidationResults
   */
  this.after('READ', 'ValidationResults', (results) => {
    const resultsArray = Array.isArray(results) ? results : [results];
    resultsArray.forEach(result => {
      if (result) {
        result.validationCriticality = result.isValid ? 3 : 1; // Green if valid, Red if not
        result.confidenceCriticality = calculateCriticality(result.confidence || 0);
      }
    });
  });

  /**
   * Upload file handler - accepts .eml or .pdf
   */
  this.on('uploadFile', async (req) => {
    const { fileName, fileContent, mimeType, schemaId } = req.data;

    console.log(`Upload file: ${fileName}, type: ${mimeType}, schemaId: ${schemaId}`);

    // Convert fileContent to Buffer if it's a string (base64)
    let fileBuffer;
    if (typeof fileContent === 'string') {
      fileBuffer = Buffer.from(fileContent, 'base64');
    } else if (Buffer.isBuffer(fileContent)) {
      fileBuffer = fileContent;
    } else {
      req.error(400, 'Invalid file content format');
    }

    console.log(`File size: ${fileBuffer.length} bytes`);

    // Determine file type
    const fileType = fileName.toLowerCase().endsWith('.eml') ? 'eml' :
                     fileName.toLowerCase().endsWith('.pdf') ? 'pdf' : 'unknown';

    if (fileType === 'unknown') {
      req.error(400, 'Invalid file type. Only .eml and .pdf files are supported.');
    }

    // Create processing batch
    const batchId = require('crypto').randomUUID();
    await INSERT.into(ProcessingBatches).entries({
      ID: batchId,
      fileName,
      fileType,
      uploadedAt: new Date().toISOString(),
      status: 'uploaded',
      totalDocuments: 0,
      processedDocuments: 0,
      schemaId: schemaId || null
    });

    console.log(`Created batch: ${batchId}`);

    let documents = [];

    try {
      if (fileType === 'eml') {
        // Parse email to extract PDF attachments
        documents = await parseEmailAttachments(fileBuffer, batchId);
      } else if (fileType === 'pdf') {
        // Direct PDF upload
        documents.push({
          batch_ID: batchId,
          fileName,
          fileContent: fileBuffer,
          mimeType,
          uploadedAt: new Date().toISOString(),
          status: 'pending'
        });
      }

      // Store documents
      if (documents.length > 0) {
        await INSERT.into(Documents).entries(documents);
      }

      // Update batch with document count
      await UPDATE(ProcessingBatches, batchId).set({
        totalDocuments: documents.length,
        status: 'extracted'
      });

      console.log(`Batch ${batchId}: Extracted ${documents.length} documents`);

      return SELECT.one.from(ProcessingBatches).where({ ID: batchId });

    } catch (error) {
      console.error('Upload error:', error);
      await UPDATE(ProcessingBatches, batchId).set({
        status: 'failed'
      });
      req.error(500, `Upload failed: ${error.message}`);
    }
  });

  /**
   * Process single document - send to DocAI
   */
  this.on('processDocument', async (req) => {
    const { documentId } = req.data;

    console.log(`Process document: ${documentId}`);

    // Retrieve document - must explicitly select fileContent for LargeBinary
    const doc = await SELECT.one.from(Documents)
      .columns('ID', 'fileName', 'fileContent', 'batch_ID', 'status')
      .where({ ID: documentId });

    if (!doc) {
      req.error(404, 'Document not found');
    }

    console.log(`Document fileContent type: ${typeof doc.fileContent}, exists: ${!!doc.fileContent}`);

    if (!doc.fileContent) {
      req.error(400, 'Document has no file content');
    }

    // Get batch to retrieve schemaId
    const batch = await SELECT.one.from(ProcessingBatches).where({ ID: doc.batch_ID });
    const schemaId = batch?.schemaId || process.env.DOCAI_SCHEMA_VERSION_ID;

    if (!schemaId) {
      req.error(400, 'No schema ID available. Set schemaId in batch or DOCAI_SCHEMA_VERSION_ID environment variable');
    }

    try {
      // Update status to processing
      await UPDATE(Documents, documentId).set({
        status: 'processing'
      });

      // Submit to DocAI with schema from batch
      const docaiDocumentId = await submitToDocAI(doc.fileContent, doc.fileName, schemaId);

      // Store DocAI document ID
      await UPDATE(Documents, documentId).set({
        docaiDocumentId,
        extractionStatus: 'PENDING'
      });

      console.log(`Document ${documentId} submitted to DocAI: ${docaiDocumentId}`);

      return {
        status: 'processing',
        message: 'Document submitted to DocAI for extraction',
        docaiDocumentId
      };

    } catch (error) {
      console.error('Process document error:', error);
      await UPDATE(Documents, documentId).set({
        status: 'failed',
        extractionError: error.message
      });
      req.error(500, `Processing failed: ${error.message}`);
    }
  });

  /**
   * Process batch - trigger all documents in batch with polling
   */
  this.on('processBatch', async (req) => {
    const { batchId } = req.data;

    console.log(`Process batch: ${batchId}`);

    const batch = await SELECT.one.from(ProcessingBatches).where({ ID: batchId });

    if (!batch) {
      req.error(404, 'Batch not found');
    }

    const documents = await SELECT.from(Documents).where({
      batch_ID: batchId,
      status: 'pending'
    });

    console.log(`Batch ${batchId}: Processing ${documents.length} documents`);

    let processed = 0;
    let succeeded = 0;
    let failed = 0;

    // Process documents sequentially with polling
    for (const doc of documents) {
      try {
        console.log(`Processing document ${doc.ID}...`);
        const result = await this.send({
          event: 'processDocumentWithPolling',
          data: {
            documentId: doc.ID,
            maxPolls: 30,
            pollInterval: 5000
          }
        });

        processed++;

        if (result.status === 'extracted') {
          succeeded++;
          console.log(`Document ${doc.ID} extracted successfully`);
        } else {
          failed++;
          console.log(`Document ${doc.ID} processing incomplete: ${result.status}`);
        }
      } catch (error) {
        console.error(`Failed to process document ${doc.ID}:`, error);
        processed++;
        failed++;
      }
    }

    // Update batch status
    const batchStatus = failed === 0 ? 'completed' : succeeded > 0 ? 'partial' : 'failed';

    await UPDATE(ProcessingBatches, batchId).set({
      status: batchStatus,
      processedDocuments: processed
    });

    return {
      status: batchStatus,
      totalDocuments: documents.length,
      processedDocuments: processed,
      succeededDocuments: succeeded,
      failedDocuments: failed
    };
  });

  /**
   * Validate document - check mandatory fields
   */
  this.on('validateDocument', async (req) => {
    const { documentId } = req.data;

    console.log(`Validate document: ${documentId}`);

    const doc = await SELECT.one.from(Documents).where({ ID: documentId });

    if (!doc) {
      req.error(404, 'Document not found');
    }

    // Retrieve header
    const header = await SELECT.one.from(InvoiceHeader).where({ document_ID: documentId });

    if (!header) {
      req.error(400, 'No extraction data found for document');
    }

    const mandatoryFields = [
      { name: 'invoiceNumber', label: 'Invoice Number' },
      { name: 'supplier', label: 'Supplier' },
      { name: 'amount', label: 'Amount' },
      { name: 'invoiceDate', label: 'Invoice Date' },
      { name: 'poNumber', label: 'PO Number' }
    ];

    const confidenceThreshold = parseFloat(process.env.VALIDATION_CONFIDENCE_THRESHOLD || '0.85');
    const validationResults = [];
    const missingFields = [];

    for (const field of mandatoryFields) {
      const value = header[field.name];
      const confidence = header[`${field.name}_confidence`] || 0;

      let isValid = true;
      let errorMessage = null;

      if (value === null || value === undefined || value === '') {
        isValid = false;
        errorMessage = `${field.label} is missing`;
        missingFields.push(field.label);
      } else if (confidence < confidenceThreshold) {
        isValid = false;
        errorMessage = `${field.label} confidence (${confidence}) below threshold (${confidenceThreshold})`;
      }

      // Additional validation rules
      if (field.name === 'amount' && value !== null && value <= 0) {
        isValid = false;
        errorMessage = 'Amount must be positive';
      }

      if (field.name === 'invoiceDate' && value !== null) {
        const invoiceDate = new Date(value);
        const today = new Date();
        if (invoiceDate > today) {
          isValid = false;
          errorMessage = 'Invoice date cannot be in the future';
        }
      }

      validationResults.push({
        document_ID: documentId,
        fieldName: field.name,
        isValid,
        isMandatory: true,
        value: value ? String(value) : null,
        confidence,
        errorMessage,
        validatedAt: new Date().toISOString()
      });
    }

    // Store validation results
    await DELETE.from(ValidationResults).where({ document_ID: documentId });
    await INSERT.into(ValidationResults).entries(validationResults);

    const isValid = missingFields.length === 0 && validationResults.every(v => v.isValid);

    // Update document status
    await UPDATE(Documents, documentId).set({
      status: isValid ? 'validated' : 'failed'
    });

    console.log(`Document ${documentId} validation: ${isValid ? 'passed' : 'failed'}`);

    return {
      isValid,
      missingFields,
      validationDetails: validationResults.map(v => ({
        field: v.fieldName,
        status: v.isValid ? 'valid' : 'invalid',
        confidence: v.confidence
      }))
    };
  });

  /**
   * Parse email attachments
   */
  async function parseEmailAttachments(emlBuffer, batchId) {
    const documents = [];

    try {
      const mail = await simpleParser(emlBuffer);

      if (!mail.attachments || mail.attachments.length === 0) {
        console.log('No attachments found in email');
        return [];
      }

      for (const attachment of mail.attachments) {
        const fileName = attachment.filename || 'attachment';

        // Check if PDF
        if (fileName.toLowerCase().endsWith('.pdf')) {
          documents.push({
            batch_ID: batchId,
            fileName,
            fileContent: attachment.content,
            mimeType: 'application/pdf',
            uploadedAt: new Date().toISOString(),
            status: 'pending'
          });
        }
        // Check if ZIP
        else if (fileName.toLowerCase().endsWith('.zip')) {
          const zipDocs = await extractPdfsFromZip(attachment.content, batchId);
          documents.push(...zipDocs);
        }
      }

      return documents;
    } catch (error) {
      console.error('Email parsing error:', error);
      throw error;
    }
  }

  /**
   * Extract PDFs from ZIP file
   */
  async function extractPdfsFromZip(zipBuffer, batchId) {
    const documents = [];
    const zip = new AdmZip(zipBuffer);
    const zipEntries = zip.getEntries();

    for (const entry of zipEntries) {
      if (!entry.isDirectory && entry.entryName.toLowerCase().endsWith('.pdf')) {
        documents.push({
          batch_ID: batchId,
          fileName: entry.entryName,
          fileContent: entry.getData(),
          mimeType: 'application/pdf',
          uploadedAt: new Date().toISOString(),
          status: 'pending'
        });
      }
    }

    return documents;
  }

  /**
   * Helper function to convert stream to Buffer
   */
  async function streamToBuffer(stream) {
    return new Promise((resolve, reject) => {
      const chunks = [];
      stream.on('data', chunk => chunks.push(chunk));
      stream.on('end', () => resolve(Buffer.concat(chunks)));
      stream.on('error', reject);
    });
  }

  /**
   * Submit document to DocAI v4 - upload file and create document via schema execution
   */
  async function submitToDocAI(fileContent, fileName, schemaId) {
    const destinationName = process.env.DOCAI_DESTINATION || 'docai-destination';

    if (!schemaId) {
      throw new Error('schemaId is required for DocAI submission');
    }

    try {
      const axios = require('axios');
      const { getDestination } = require('@sap-cloud-sdk/connectivity');
      const { Readable } = require('stream');

      // Log what we received
      console.log(`submitToDocAI - fileContent type: ${typeof fileContent}`);
      console.log(`submitToDocAI - isBuffer: ${Buffer.isBuffer(fileContent)}`);
      console.log(`submitToDocAI - isReadable: ${fileContent instanceof Readable}`);

      if (fileContent) {
        console.log(`submitToDocAI - constructor: ${fileContent.constructor?.name}`);
      }

      // Ensure fileContent is a Buffer
      let pdfBuffer;
      if (Buffer.isBuffer(fileContent)) {
        pdfBuffer = fileContent;
      } else if (fileContent instanceof Readable) {
        // Handle CAP LargeBinary as Readable stream
        console.log('Converting Readable stream to Buffer...');
        pdfBuffer = await streamToBuffer(fileContent);
        console.log(`Stream converted to Buffer, size: ${pdfBuffer.length} bytes`);
      } else if (typeof fileContent === 'string') {
        // Handle base64 encoded strings
        pdfBuffer = Buffer.from(fileContent, 'base64');
      } else if (fileContent && fileContent.buffer) {
        // Handle ArrayBuffer or similar
        pdfBuffer = Buffer.from(fileContent.buffer);
      } else if (fileContent && typeof fileContent === 'object' && fileContent.type === 'Buffer' && Array.isArray(fileContent.data)) {
        // Handle serialized Buffer (from JSON)
        pdfBuffer = Buffer.from(fileContent.data);
      } else {
        console.error('Invalid fileContent:', fileContent);
        throw new Error('Invalid fileContent format - must be Buffer, Readable stream, base64 string, or ArrayBuffer');
      }

      console.log(`Uploading file: ${fileName}, size: ${pdfBuffer.length} bytes`);

      // Get destination config
      const destConfig = await getDestination({ destinationName });
      const baseUrl = destConfig.url.replace(/\/$/, '');

      const authHeaders = destConfig.authTokens && destConfig.authTokens.length > 0
        ? { 'Authorization': `Bearer ${destConfig.authTokens[0].value}` }
        : {};

      // Step 1: Get schema to determine correct clientId
      const schemaUrl = `${baseUrl}/SchemaService/SchemaVersions(${schemaId})?$expand=schema`;
      console.log('Fetching schema details:', schemaUrl);

      const schemaResponse = await axios.get(schemaUrl, {
        headers: authHeaders
      });

      const schemaClientId = schemaResponse.data.schema?.clientId || 'default';
      console.log('Schema clientId:', schemaClientId);

      // Step 2: Upload File - match exact format from docai-test.html
      const FormData = require('form-data');
      const formData = new FormData();

      // Append file with exact options structure
      formData.append('file', pdfBuffer, {
        filename: fileName,
        contentType: 'application/pdf'
      });

      // Append clientId as separate field
      formData.append('clientId', schemaClientId);

      const uploadUrl = `${baseUrl}/FileService/Files/Upload`;
      console.log('Upload URL:', uploadUrl);

      const uploadResponse = await axios.post(uploadUrl, formData, {
        headers: {
          ...formData.getHeaders(),
          ...authHeaders
        },
        maxBodyLength: Infinity,
        maxContentLength: Infinity
      });

      const fileId = uploadResponse.data.ID;
      console.log('File uploaded, ID:', fileId);
      console.log('File clientId:', uploadResponse.data.clientId);

      // Step 3: Create Document by executing schema
      const executeUrl = `${baseUrl}/SchemaService/SchemaVersions(${schemaId})/execute`;
      console.log('Execute URL:', executeUrl);

      const executeResponse = await axios.post(executeUrl, {
        fileId: fileId,
        clientId: schemaClientId
      }, {
        headers: {
          'Content-Type': 'application/json',
          ...authHeaders
        }
      });

      console.log('Document created:', executeResponse.data);

      // Extract documentId from nested structure
      const documentId = executeResponse.data.execute?.documentId || executeResponse.data.documentId;

      if (!documentId) {
        throw new Error('No documentId returned from schema execution');
      }

      return documentId;

    } catch (error) {
      console.error('DocAI submission error:', error.response?.data || error.message);
      throw new Error(`DocAI submission failed: ${error.response?.data?.error?.message || error.message}`);
    }
  }

  /**
   * Store extraction results
   */
  async function storeExtractionResults(documentId, invoice) {
    if (!invoice || !invoice.header) {
      throw new Error('Invalid invoice data');
    }

    // Store header
    await DELETE.from(InvoiceHeader).where({ document_ID: documentId });
    await INSERT.into(InvoiceHeader).entries({
      document_ID: documentId,
      ...invoice.header
    });

    // Store line items
    if (invoice.lineItems && invoice.lineItems.length > 0) {
      await DELETE.from(InvoiceLineItems).where({ document_ID: documentId });
      const lineItemsWithDocId = invoice.lineItems.map(item => ({
        document_ID: documentId,
        ...item
      }));
      await INSERT.into(InvoiceLineItems).entries(lineItemsWithDocId);
    }

    console.log(`Stored extraction results for document ${documentId}`);
  }

  // Make storeExtractionResults available to webhook service
  this.storeExtractionResults = storeExtractionResults;

  /**
   * DocAI v4 API Test Actions
   */

  // Get available active schemas
  this.on('getAvailableSchemas', async (req) => {
    const { destination } = req.data;

    try {
      const axios = require('axios');
      const { getDestination } = require('@sap-cloud-sdk/connectivity');

      const destConfig = await getDestination({ destinationName: destination || 'docai-destination' });
      const baseUrl = destConfig.url.replace(/\/$/, '');

      const authHeaders = destConfig.authTokens && destConfig.authTokens.length > 0
        ? { 'Authorization': `Bearer ${destConfig.authTokens[0].value}` }
        : {};

      // Fetch active schema versions with schema details
      const schemasUrl = `${baseUrl}/SchemaService/SchemaVersions?$filter=isActive eq true&$expand=schema`;
      console.log('Fetching schemas:', schemasUrl);

      const response = await axios.get(schemasUrl, {
        headers: authHeaders
      });

      const schemas = response.data.value.map(sv => ({
        id: sv.ID,
        name: sv.schema?.name || 'Unnamed Schema',
        label: sv.schema?.label || sv.label || sv.schema?.name,
        description: sv.description || sv.schema?.description,
        version: sv.version,
        schemaId: sv.schema?.ID,
        clientId: sv.schema?.clientId
      }));

      console.log(`Found ${schemas.length} active schemas`);

      return { schemas };

    } catch (error) {
      console.error('Get schemas error:', error.response?.data || error.message);
      req.error(500, `Failed to fetch schemas: ${error.response?.data?.error?.message || error.message}`);
    }
  });

  // Test API connection
  this.on('testDocAI', async (req) => {
    const { destination } = req.data;

    try {
      // Try to fetch the list of files to test connectivity
      const response = await executeHttpRequest(
        { destinationName: destination || 'docai-destination' },
        {
          method: 'GET',
          url: '/FileService/Files',
          params: {
            '$top': 1
          }
        }
      );

      return {
        success: true,
        message: 'Connection successful',
        filesCount: response.data.value ? response.data.value.length : 0
      };
    } catch (error) {
      console.error('Test connection error:', error);
      req.error(500, `Connection test failed: ${error.message}`);
    }
  });

  // Submit document to DocAI v4
  this.on('submitToDocAI', async (req) => {
    const { destination, schemaId: requestSchemaId, clientId, ocrEngine, fileName, fileContent } = req.data;

    try {
      const FormData = require('form-data');
      const axios = require('axios');
      const { getDestination } = require('@sap-cloud-sdk/connectivity');

      // Convert base64 to buffer
      const pdfBuffer = Buffer.from(fileContent, 'base64');
      console.log(`Uploading file: ${fileName}, size: ${pdfBuffer.length} bytes`);

      // Get destination config
      const destConfig = await getDestination({ destinationName: destination || 'docai-destination' });
      console.log('Destination URL:', destConfig.url);
      const baseUrl = destConfig.url.replace(/\/$/, '');

      const authHeaders = destConfig.authTokens && destConfig.authTokens.length > 0
        ? { 'Authorization': `Bearer ${destConfig.authTokens[0].value}` }
        : {};

      // Step 1: Get schema to determine correct clientId
      // Use provided schemaId or fallback to environment variable
      const schemaId = requestSchemaId || process.env.DOCAI_SCHEMA_VERSION_ID;
      if (!schemaId) {
        throw new Error('schemaId is required to create Document. Provide in request or set DOCAI_SCHEMA_VERSION_ID environment variable');
      }
      console.log('Using schemaId:', schemaId);

      const schemaUrl = `${baseUrl}/SchemaService/SchemaVersions(${schemaId})?$expand=schema`;
      console.log('Fetching schema details:', schemaUrl);

      const schemaResponse = await axios.get(schemaUrl, {
        headers: authHeaders
      });

      const schemaClientId = schemaResponse.data.schema?.clientId;
      console.log('Schema clientId:', schemaClientId);

      // Use schema's clientId, or fallback to provided clientId, or 'default'
      const effectiveClientId = schemaClientId || clientId || 'default';
      console.log('Using clientId for file upload:', effectiveClientId);

      // Step 2: Upload File with correct clientId
      const formData = new FormData();
      formData.append('file', pdfBuffer, {
        filename: fileName,
        contentType: 'application/pdf'
      });

      formData.append('clientId', effectiveClientId);

      if (ocrEngine) {
        formData.append('ocrEngine', ocrEngine);
      }

      const uploadUrl = `${baseUrl}/FileService/Files/Upload`;
      console.log('Upload URL:', uploadUrl);

      const uploadResponse = await axios.post(uploadUrl, formData, {
        headers: {
          ...formData.getHeaders(),
          ...authHeaders
        },
        maxBodyLength: Infinity,
        maxContentLength: Infinity
      });

      const fileId = uploadResponse.data.ID;
      console.log('File uploaded, ID:', fileId);
      console.log('File clientId:', uploadResponse.data.clientId);

      // Step 3: Create Document by executing schema
      console.log('Creating Document with schemaId:', schemaId);
      const executeUrl = `${baseUrl}/SchemaService/SchemaVersions(${schemaId})/execute`;
      console.log('Execute URL:', executeUrl);

      const executeResponse = await axios.post(executeUrl, {
        fileId: fileId,
        clientId: effectiveClientId
      }, {
        headers: {
          'Content-Type': 'application/json',
          ...authHeaders
        }
      });

      console.log('Document created:', executeResponse.data);

      // Extract documentId from nested structure
      const documentId = executeResponse.data.execute?.documentId || executeResponse.data.documentId;
      const status = executeResponse.data.execute?.status || executeResponse.data.status || 'processing';

      return {
        fileId: fileId,
        documentId: documentId,
        status: status,
        createdAt: uploadResponse.data.createdAt
      };

    } catch (error) {
      console.error('DocAI v4 submission error:', error.response?.data || error.message);
      req.error(500, `DocAI submission failed: ${error.response?.data?.error?.message || error.message}`);
    }
  });

  // Get document status
  this.on('getDocAIStatus', async (req) => {
    const { destination, documentId } = req.data;

    try {
      const axios = require('axios');
      const { getDestination } = require('@sap-cloud-sdk/connectivity');

      // Get destination config
      const destConfig = await getDestination({ destinationName: destination || 'docai-destination' });

      // Build URL - ensure no double slash
      // OData v4: UUID/GUID values don't need quotes
      const baseUrl = destConfig.url.replace(/\/$/, '');
      const statusUrl = `${baseUrl}/DocumentService/Documents(${documentId})`;
      console.log('Status check URL:', statusUrl);

      const authHeaders = destConfig.authTokens && destConfig.authTokens.length > 0
        ? { 'Authorization': `Bearer ${destConfig.authTokens[0].value}` }
        : {};

      const response = await axios.get(statusUrl, {
        headers: authHeaders
      });

      return {
        status: response.data.status,
        id: response.data.ID,
        createdAt: response.data.createdAt,
        finishedAt: response.data.finishedAt,
        details: JSON.stringify(response.data)
      };

    } catch (error) {
      console.error('DocAI v4 status check error:', error.response?.data || error.message);
      req.error(500, `Status check failed: ${error.response?.data?.error?.message || error.message}`);
    }
  });

  // Get extraction results
  this.on('getDocAIResults', async (req) => {
    const { destination, documentId } = req.data;

    try {
      const axios = require('axios');
      const { getDestination } = require('@sap-cloud-sdk/connectivity');

      // Get destination config
      const destConfig = await getDestination({ destinationName: destination || 'docai-destination' });

      // Build URL with expand - ensure no double slash
      // OData v4: UUID/GUID values don't need quotes
      const baseUrl = destConfig.url.replace(/\/$/, '');
      const resultsUrl = `${baseUrl}/DocumentService/Documents(${documentId})?$expand=versions($expand=entities)`;
      console.log('Results fetch URL:', resultsUrl);

      const authHeaders = destConfig.authTokens && destConfig.authTokens.length > 0
        ? { 'Authorization': `Bearer ${destConfig.authTokens[0].value}` }
        : {};

      const response = await axios.get(resultsUrl, {
        headers: authHeaders
      });

      // Parse and structure the results
      const documentData = response.data;
      const versions = documentData.versions || [];

      console.log('Document data keys:', Object.keys(documentData));
      console.log('Document file_ID:', documentData.file_ID);

      // Get file data separately using file_ID - need to fetch the actual content stream
      let fileData = null;
      if (documentData.file_ID) {
        try {
          // Fetch the file content using the $value endpoint for media streams
          const fileUrl = `${baseUrl}/FileService/Files(${documentData.file_ID})/content`;
          console.log('Fetching file content from:', fileUrl);

          const fileResponse = await axios.get(fileUrl, {
            headers: authHeaders,
            responseType: 'arraybuffer'
          });

          console.log('File response status:', fileResponse.status);
          console.log('File response content-type:', fileResponse.headers['content-type']);

          // Convert arraybuffer to base64
          if (fileResponse.data) {
            fileData = Buffer.from(fileResponse.data).toString('base64');
            console.log('PDF file data retrieved, base64 length:', fileData.length);
          }
        } catch (fileError) {
          console.error('Failed to fetch file:', fileError.response?.data || fileError.message);
          console.error('File error status:', fileError.response?.status);
          console.error('File URL attempted:', `${baseUrl}/FileService/Files(${documentData.file_ID})/content`);
        }
      } else {
        console.log('No file_ID found in document data');
      }

      if (versions.length === 0) {
        return {
          headerFields: [],
          lineItems: [],
          fileData: fileData,
          rawResults: JSON.stringify(documentData)
        };
      }

      // Get the latest version (highest version number)
      const latestVersion = versions.reduce((prev, current) =>
        (current.version > prev.version) ? current : prev
      );

      const entities = latestVersion.entities || [];

      // Separate header fields and line items
      const headerFields = [];
      const lineItemGroups = {}; // Group by occurrence for line items

      // Build parent lookup map
      const entityMap = {};
      entities.forEach(entity => {
        entityMap[entity.ID] = entity;
      });

      // Helper to find root parent name
      function getRootParentName(entity) {
        let current = entity;
        while (current.parent_ID) {
          const parent = entityMap[current.parent_ID];
          if (!parent) break;
          current = parent;
        }
        return current.name;
      }

      // Process entities - only Fields (not Groups or Tables)
      entities.forEach(entity => {
        if (entity.type !== 'Field') return;

        const rootParent = getRootParentName(entity);

        if (rootParent === 'invoiceItemDetails') {
          // Line item field
          const occurrence = entity.occurrence || 1;
          if (!lineItemGroups[occurrence]) {
            lineItemGroups[occurrence] = {
              occurrence: occurrence,
              fields: []
            };
          }
          lineItemGroups[occurrence].fields.push({
            ID: entity.ID,
            name: entity.name,
            label: entity.label,
            dataType: entity.dataType,
            stringValue: entity.stringValue,
            numberValue: entity.numberValue,
            dateValue: entity.dateValue,
            rawValue: entity.rawValue,
            confidence: entity.confidence,
            signedOff: entity.signedOff
          });
        } else {
          // Header field
          headerFields.push({
            ID: entity.ID,
            name: entity.name,
            label: entity.label,
            dataType: entity.dataType,
            stringValue: entity.stringValue,
            numberValue: entity.numberValue,
            dateValue: entity.dateValue,
            rawValue: entity.rawValue,
            confidence: entity.confidence,
            signedOff: entity.signedOff,
            parent_ID: entity.parent_ID
          });
        }
      });

      // Convert line item groups to array and sort by occurrence
      const lineItems = Object.values(lineItemGroups).sort((a, b) => a.occurrence - b.occurrence);

      console.log(`Parsed ${headerFields.length} header fields and ${lineItems.length} line items`);

      return {
        headerFields: headerFields,
        lineItems: lineItems,
        documentConfidence: documentData.confidenceScore || 0,
        fileData: fileData,
        rawResults: JSON.stringify(documentData)
      };

    } catch (error) {
      console.error('DocAI v4 results fetch error:', error.response?.data || error.message);
      req.error(500, `Results fetch failed: ${error.response?.data?.error?.message || error.message}`);
    }
  });

  // Poll document status and fetch results when ready
  this.on('pollAndProcessDocument', async (req) => {
    const { documentId } = req.data;

    try {
      const doc = await SELECT.one.from(Documents).where({ ID: documentId });

      if (!doc) {
        req.error(404, 'Document not found');
      }

      if (!doc.docaiDocumentId) {
        req.error(400, 'Document not submitted to DocAI');
      }

      const axios = require('axios');
      const { getDestination } = require('@sap-cloud-sdk/connectivity');
      const destConfig = await getDestination({ destinationName: process.env.DOCAI_DESTINATION || 'docai-destination' });

      const baseUrl = destConfig.url.replace(/\/$/, '');
      const authHeaders = destConfig.authTokens && destConfig.authTokens.length > 0
        ? { 'Authorization': `Bearer ${destConfig.authTokens[0].value}` }
        : {};

      // Check status
      const statusUrl = `${baseUrl}/DocumentService/Documents(${doc.docaiDocumentId})`;
      const statusResponse = await axios.get(statusUrl, { headers: authHeaders });

      const status = statusResponse.data.status;
      console.log(`Document ${documentId} DocAI status: ${status}`);

      await UPDATE(Documents, documentId).set({
        extractionStatus: status
      });

      // If reviewNeeded, fetch and store results
      if (status === 'reviewNeeded') {
        const resultsUrl = `${baseUrl}/DocumentService/Documents(${doc.docaiDocumentId})?$expand=versions($expand=entities)`;
        const resultsResponse = await axios.get(resultsUrl, { headers: authHeaders });

        const invoice = parseDocumentResult(resultsResponse.data);

        if (invoice) {
          await storeExtractionResults(documentId, invoice);
          await UPDATE(Documents, documentId).set({
            status: 'extracted'
          });

          // Auto-validate
          await this.send({
            event: 'validateDocument',
            data: { documentId }
          });

          return {
            status: 'extracted',
            message: 'Extraction completed and validated',
            invoice
          };
        }
      }

      return {
        status: status,
        message: status === 'inProgress' ? 'Processing in progress' : `Status: ${status}`
      };

    } catch (error) {
      console.error('Poll and process error:', error);
      await UPDATE(Documents, documentId).set({
        status: 'failed',
        extractionError: error.message
      });
      req.error(500, `Poll failed: ${error.message}`);
    }
  });

  /**
   * Process document with polling - submit, poll until reviewNeeded, and extract
   */
  /**
   * Process document with polling - submit, poll until reviewNeeded, and extract
   */
  this.on('processDocumentWithPolling', async (req) => {
    const { documentId, maxPolls = 30, pollInterval = 5000 } = req.data;

    try {
      // Select document - must explicitly select fileContent for LargeBinary
      const doc = await SELECT.one.from(Documents)
        .columns('ID', 'fileName', 'fileContent', 'batch_ID', 'status')
        .where({ ID: documentId });

      if (!doc) {
        req.error(404, 'Document not found');
      }

      // Log fileContent type for debugging
      console.log(`[${documentId}] fileContent type: ${typeof doc.fileContent}, isBuffer: ${Buffer.isBuffer(doc.fileContent)}, exists: ${!!doc.fileContent}`);

      if (!doc.fileContent) {
        req.error(400, 'Document has no file content');
      }

      const batch = await SELECT.one.from(ProcessingBatches).where({ ID: doc.batch_ID });
      const schemaId = batch?.schemaId || process.env.DOCAI_SCHEMA_VERSION_ID;

      if (!schemaId) {
        req.error(400, 'No schema ID available');
      }

      // Step 1: Submit to DocAI
      console.log(`[${documentId}] Submitting to DocAI...`);
      await UPDATE(Documents, documentId).set({ status: 'processing' });

      const docaiDocumentId = await submitToDocAI(doc.fileContent, doc.fileName, schemaId);

      await UPDATE(Documents, documentId).set({
        docaiDocumentId,
        extractionStatus: 'inProgress'
      });

      console.log(`[${documentId}] Submitted to DocAI: ${docaiDocumentId}`);

      // Step 2: Poll for status
      const axios = require('axios');
      const { getDestination } = require('@sap-cloud-sdk/connectivity');
      const destConfig = await getDestination({ destinationName: process.env.DOCAI_DESTINATION || 'docai-destination' });

      const baseUrl = destConfig.url.replace(/\/$/, '');
      const authHeaders = destConfig.authTokens && destConfig.authTokens.length > 0
        ? { 'Authorization': `Bearer ${destConfig.authTokens[0].value}` }
        : {};

      let polls = 0;
      let status = 'inProgress';

      while (polls < maxPolls && status !== 'reviewNeeded' && status !== 'failed') {
        await new Promise(resolve => setTimeout(resolve, pollInterval));
        polls++;

        const statusUrl = `${baseUrl}/DocumentService/Documents(${docaiDocumentId})`;
        const statusResponse = await axios.get(statusUrl, { headers: authHeaders });
        status = statusResponse.data.status;

        console.log(`[${documentId}] Poll ${polls}/${maxPolls}: status=${status}`);

        await UPDATE(Documents, documentId).set({ extractionStatus: status });
      }

      // Step 3: Extract and store results if reviewNeeded
      if (status === 'reviewNeeded') {
        console.log(`[${documentId}] Fetching extraction results...`);
        const resultsUrl = `${baseUrl}/DocumentService/Documents(${docaiDocumentId})?$expand=versions($expand=entities)`;
        const resultsResponse = await axios.get(resultsUrl, { headers: authHeaders });

        const invoice = parseDocumentResult(resultsResponse.data);

        if (invoice) {
          await storeExtractionResults(documentId, invoice);
          await UPDATE(Documents, documentId).set({ status: 'extracted' });

          // Auto-validate
          await this.send({
            event: 'validateDocument',
            data: { documentId }
          });

          console.log(`[${documentId}] Extraction completed and validated`);

          return {
            status: 'extracted',
            message: 'Extraction completed and validated',
            polls,
            invoice
          };
        }
      } else if (status === 'failed') {
        await UPDATE(Documents, documentId).set({ status: 'failed' });
        return {
          status: 'failed',
          message: 'DocAI processing failed',
          polls
        };
      } else {
        return {
          status: 'timeout',
          message: `Max polls (${maxPolls}) reached, status: ${status}`,
          polls
        };
      }

    } catch (error) {
      console.error('Process document with polling error:', error);
      await UPDATE(Documents, documentId).set({
        status: 'failed',
        extractionError: error.message
      });
      req.error(500, `Processing failed: ${error.message}`);
    }
  });

  /**
   * Get Schema Clients from DocAI SchemaService
   */
  this.on('getSchemaClients', async (req) => {
    try {
      const { destination } = req.data;
      const dest = await cds.connect.to(destination);
      const baseUrl = dest.options.url || '';

      const url = `${baseUrl}/SchemaService/Schemas?$select=clientId&$filter=clientId ne null`;
      const response = await executeHttpRequest(
        { destinationName: destination },
        { method: 'GET', url }
      );

      const data = response.data;
      const schemas = data.value || [];
      const clientIds = [...new Set(schemas.map(s => s.clientId).filter(c => c))];

      return { clients: clientIds };
    } catch (error) {
      console.error('getSchemaClients error:', error);
      req.error(500, `Failed to fetch clients: ${error.message}`);
    }
  });

  /**
   * Get Schema Versions List from DocAI SchemaService
   */
  this.on('getSchemaVersionsList', async (req) => {
    try {
      const { destination } = req.data;
      const dest = await cds.connect.to(destination);
      const baseUrl = dest.options.url || '';

      const url = `${baseUrl}/SchemaService/SchemaVersions?$filter=isActive eq true&$expand=schema`;
      const response = await executeHttpRequest(
        { destinationName: destination },
        { method: 'GET', url }
      );

      const data = response.data;
      const schemaVersions = data.value || [];

      return { schemaVersions: schemaVersions.map(sv => JSON.stringify(sv)) };
    } catch (error) {
      console.error('getSchemaVersionsList error:', error);
      req.error(500, `Failed to fetch schema versions: ${error.message}`);
    }
  });

  /**
   * Get Schema Fields from DocAI SchemaService
   */
  this.on('getSchemaFields', async (req) => {
    try {
      const { destination, schemaVersionId } = req.data;
      const dest = await cds.connect.to(destination);
      const baseUrl = dest.options.url || '';

      const url = `${baseUrl}/SchemaService/SchemaEntities?$filter=schemaVersion_ID eq ${schemaVersionId} and type eq 'Field'`;
      const response = await executeHttpRequest(
        { destinationName: destination },
        { method: 'GET', url }
      );

      const data = response.data;
      const fields = data.value || [];

      return { fields: fields.map(f => JSON.stringify(f)) };
    } catch (error) {
      console.error('getSchemaFields error:', error);
      req.error(500, `Failed to fetch schema fields: ${error.message}`);
    }
  });

  /**
   * Update and confirm document - single call for all updates + confirmation
   */
  this.on('updateAndConfirmDocument', async (req) => {
    const { documentId, entities, useForInstantLearning } = req.data;

    try {
      const axios = require('axios');
      const { getDestination } = require('@sap-cloud-sdk/connectivity');

      const destinationName = process.env.DOCAI_DESTINATION || 'docai-destination';
      const destConfig = await getDestination({ destinationName });
      const baseUrl = destConfig.url.replace(/\/$/, '');

      const authHeaders = destConfig.authTokens && destConfig.authTokens.length > 0
        ? { 'Authorization': `Bearer ${destConfig.authTokens[0].value}` }
        : {};

      console.log(`Updating and confirming document ${documentId} with ${entities.length} entities`);

      // Step 1: Update all entities with a single batch request
      if (entities && entities.length > 0) {
        const batchRequests = entities.map(entity => {
          const updatePayload = {};

          // Only include the relevant value field based on what's provided
          if (entity.stringValue !== null && entity.stringValue !== undefined) {
            updatePayload.stringValue = entity.stringValue;
          }
          if (entity.numberValue !== null && entity.numberValue !== undefined) {
            updatePayload.numberValue = entity.numberValue;
          }
          if (entity.dateValue !== null && entity.dateValue !== undefined) {
            updatePayload.dateValue = entity.dateValue;
          }

          return {
            method: 'PATCH',
            url: `/DocumentService/DocumentEntities(${entity.entityId})`,
            body: updatePayload
          };
        });

        console.log(`Executing batch update with ${batchRequests.length} requests`);

        // Execute all updates in parallel
        const updatePromises = batchRequests.map(async request => {
          const updateUrl = `${baseUrl}${request.url}`;
          return axios.patch(updateUrl, request.body, {
            headers: {
              'Content-Type': 'application/json',
              ...authHeaders
            }
          });
        });

        await Promise.all(updatePromises);
        console.log('All entity updates completed');
      }

      // Step 2: Confirm document
      const confirmUrl = `${baseUrl}/DocumentService/Documents(${documentId})/DocumentService.confirmed`;
      console.log('Confirming document at:', confirmUrl);

      const confirmPayload = {
        ID: documentId,
        useForInstantLearning: useForInstantLearning || false
      };

      const confirmResponse = await axios.post(confirmUrl, confirmPayload, {
        headers: {
          'Content-Type': 'application/json',
          ...authHeaders
        }
      });

      console.log('Document confirmed successfully');

      return {
        success: true,
        message: 'Document updated and confirmed successfully'
      };

    } catch (error) {
      console.error('Update and confirm error:', error.response?.data || error.message);
      req.error(500, `Failed to update and confirm: ${error.response?.data?.error?.message || error.message}`);
    }
  });
});
