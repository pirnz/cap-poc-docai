/**
 * Callback Service Implementation
 *
 * Handles DocAI callbacks and stores extraction results for any schema type.
 * Schema-agnostic design: works with invoices, purchase orders, delivery notes, etc.
 */

const cds = require('@sap/cds');
const { parseGroovyToJson } = require('./utils/groovy-parser');

module.exports = cds.service.impl(async function() {
  const db = await cds.connect.to('db');
  const { Documents, InvoiceHeader, InvoiceLineItems } = db.entities('com.sap.docai');

  /**
   * DocAI Callback Handler
   *
   * Receives extraction results from DocAI service and stores them in database.
   * Works with any schema - dynamically extracts header fields and line items.
   */
  this.on('callback', async (req) => {
    try {
      console.log('\n=== DocAI Callback Received ===');

      // Extract payload
      const rawBody = req._.req.body;
      let payload = req.data.payload || req.data || rawBody;

      console.log(`[DEBUG] Raw body type: ${typeof rawBody}`);
      console.log(`[DEBUG] Raw body: ${JSON.stringify(rawBody).substring(0, 500)}`);
      console.log(`[DEBUG] req.data type: ${typeof req.data}`);
      console.log(`[DEBUG] req.data keys: ${Object.keys(req.data || {}).join(', ')}`);

      if (typeof payload === 'string') {
        try {
          payload = JSON.parse(payload);
        } catch (e) {
          console.log('[DEBUG] Payload is not JSON string, using as-is');
        }
      }

      console.log(`[DEBUG] Final payload type: ${typeof payload}`);
      console.log(`[DEBUG] Final payload keys: ${Object.keys(payload || {}).join(', ')}`);

      // Extract notification fields
      const {
        NotificationObjectId,
        NotificationTargetStatus,
        DocumentResult
      } = payload || {};

      console.log(`📄 Document ID: ${NotificationObjectId}`);
      console.log(`📊 Status: ${NotificationTargetStatus}`);

      // Find document in database by DocAI document ID
      let documents = await cds.run(
        SELECT.from(Documents).where({ docaiDocumentId: NotificationObjectId })
      );

      let document;
      if (!documents || documents.length === 0) {
        console.log(`⚠️  No document found with DocAI ID: ${NotificationObjectId}`);
        console.log(`✨ Creating new document entry for callback-received document`);

        // Create new document entry for this callback
        const newDoc = {
          docaiDocumentId: NotificationObjectId,
          fileName: `Callback-${NotificationObjectId.substring(0, 8)}`,
          status: NotificationTargetStatus,
          extractionStatus: NotificationTargetStatus,
          clientId: 'default',
          schemaVersionId: null
        };

        const result = await cds.run(INSERT.into(Documents).entries(newDoc));

        // Fetch the newly created document
        documents = await cds.run(
          SELECT.from(Documents).where({ docaiDocumentId: NotificationObjectId })
        );
        document = documents[0];
        console.log(`✅ Created new document: ${document.ID}`);
      } else {
        document = documents[0];
        console.log(`📋 Found document: ${document.ID} (${document.fileName})`);
      }

      // Update document status for all callback types
      const statusUpdate = {
        status: NotificationTargetStatus,
        extractionStatus: NotificationTargetStatus
      };

      // Process extraction data if DocumentResult is available
      if (DocumentResult) {
        console.log('✓ DocumentResult available, processing extraction data...');
        console.log(`[DEBUG] DocumentResult type: ${typeof DocumentResult}`);

        // Parse DocumentResult with error handling
        let documentResult = null;

        try {
          if (typeof DocumentResult === 'string') {
            console.log(`[DEBUG] DocumentResult string length: ${DocumentResult.length}`);
            console.log(`[DEBUG] DocumentResult first 100 chars: ${DocumentResult.substring(0, 100)}`);

            // Check if it's Groovy/Java format (key=value instead of "key":value)
            const isGroovyFormat = DocumentResult.includes('=') && !DocumentResult.includes('":');

            if (isGroovyFormat) {
              console.log('[INFO] Parsing Groovy/Java format DocumentResult...');
              documentResult = parseGroovyToJson(DocumentResult);
              console.log('[INFO] Successfully parsed Groovy format to JSON');
            } else {
              console.log('[INFO] Parsing standard JSON DocumentResult...');
              documentResult = JSON.parse(DocumentResult);
            }
          } else {
            documentResult = DocumentResult;
          }
        } catch (parseError) {
          console.error(`[ERROR] Failed to parse DocumentResult: ${parseError.message}`);
          console.error(`[ERROR] Stack: ${parseError.stack}`);
          console.log('[WARNING] Will skip extraction data and rely on DocAI API fetch');
          documentResult = null;
        }

        // Only proceed with extraction if we successfully parsed DocumentResult
        if (!documentResult) {
          console.log('[WARNING] DocumentResult could not be parsed, updating status only');
          await cds.run(UPDATE(Documents, document.ID).with(statusUpdate));
          console.log(`✅ Document status updated to: ${statusUpdate.status} / ${statusUpdate.extractionStatus}`);
          console.log('=== Callback Processing Complete (Status Only) ===\n');
          return "Callback processed - status updated only (DocumentResult parse failed)";
        }

        // Extract schema information from document result
        const schemaVersionId = documentResult.schemaVersion?.ID || documentResult.schemaVersionId;
        const clientId = documentResult.schema?.clientId || documentResult.clientId;

        if (schemaVersionId) {
          statusUpdate.schemaVersionId = schemaVersionId;
          console.log(`[DEBUG] Schema Version ID: ${schemaVersionId}`);
        }
        if (clientId) {
          statusUpdate.clientId = clientId;
          console.log(`[DEBUG] Client ID: ${clientId}`);
        }

        // Extract entities from latest version
        const versions = documentResult.documentVersions || documentResult.versions || [];

        if (versions.length === 0) {
          console.log('⚠️  No versions found in DocumentResult');
          await UPDATE(Documents, document.ID).with({
            ...statusUpdate,
            extractionError: 'No versions in callback'
          });
          return "No versions in callback";
        }

        // Get latest version
        const latestVersion = versions.reduce((prev, current) =>
          (current.version > prev.version) ? current : prev
        );

        console.log(`[DEBUG] Latest version: ${latestVersion.version}`);

        const entities = latestVersion.entities || [];
        console.log(`[DEBUG] Total entities: ${entities.length}`);

        // Build entity map for parent lookup
        const entityMap = {};
        entities.forEach(entity => {
          entityMap[entity.ID] = entity;
        });

        // Helper to check if entity's parent is a Table
        function isTableField(entity) {
          if (!entity.parent_ID) return false;
          const parent = entityMap[entity.parent_ID];
          return parent && parent.type === 'Table';
        }

        // Separate header fields and line items
        const headerFields = [];
        const lineItemGroups = {}; // Group by occurrence for line items

        // Process entities - only Fields (not Groups or Tables)
        entities.forEach(entity => {
          if (entity.type !== 'Field') return;

          if (isTableField(entity)) {
            // Line item field - works with any table name
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

        console.log(`[INFO] Parsed ${headerFields.length} header fields and ${lineItems.length} line items`);

        // Store schema-agnostic extraction data as JSON
        const extractionData = {
          headerFields: headerFields,
          lineItems: lineItems,
          documentConfidence: documentResult.confidenceScore || 0,
          schemaVersionId: schemaVersionId,
          clientId: clientId,
          rawPayload: documentResult
        };

        statusUpdate.extractionData = JSON.stringify(extractionData);
        statusUpdate.extractionSource = 'callback';
        console.log('[INFO] Extraction data stored from callback');

        // Map common field names to invoice header structure
        const fieldMapping = {
          'invoiceNumber': 'invoiceNumber',
          'documentNumber': 'invoiceNumber',
          'supplier': 'supplier',
          'senderName': 'supplier',
          'supplierAddress': 'supplierAddress',
          'senderAddress': 'supplierAddress',
          'grossAmount': 'amount',
          'amount': 'amount',
          'totalAmount': 'amount',
          'currency': 'currency',
          'currencyCode': 'currency',
          'invoiceDate': 'invoiceDate',
          'documentDate': 'invoiceDate',
          'poNumber': 'poNumber',
          'purchaseOrderNumber': 'poNumber',
          'dueDate': 'dueDate',
          'paymentDueDate': 'dueDate',
          'taxAmount': 'taxAmount',
          'netAmount': 'netAmount'
        };

        // Build invoice header from extracted fields
        const headerData = {
          document_ID: document.ID
        };

        let totalConfidence = 0;
        let fieldCount = 0;

        headerFields.forEach(field => {
          const targetField = fieldMapping[field.name];
          if (targetField) {
            // Set value based on data type
            if (field.dataType === 'Number') {
              headerData[targetField] = field.numberValue;
            } else if (field.dataType === 'Date') {
              headerData[targetField] = field.dateValue;
            } else {
              headerData[targetField] = field.stringValue;
            }

            // Set confidence
            headerData[`${targetField}_confidence`] = field.confidence || 0;

            if (field.confidence) {
              totalConfidence += field.confidence;
              fieldCount++;
            }
          }
        });

        // Calculate overall confidence
        headerData.overallConfidence = fieldCount > 0 ? totalConfidence / fieldCount : 0;

        // Check if header already exists and delete it before inserting
        const existingHeader = await cds.run(
          SELECT.one.from(InvoiceHeader).where({ document_ID: document.ID })
        );
        if (existingHeader) {
          await cds.run(
            DELETE.from(InvoiceHeader).where({ document_ID: document.ID })
          );
          console.log('🔄 Deleted existing invoice header');
        }

        // Store invoice header
        await cds.run(INSERT.into(InvoiceHeader).entries(headerData));
        console.log('✅ Invoice header stored successfully');

        // Check if line items already exist and delete them before inserting
        const existingLineItems = await cds.run(
          SELECT.from(InvoiceLineItems).where({ document_ID: document.ID })
        );
        if (existingLineItems.length > 0) {
          await cds.run(
            DELETE.from(InvoiceLineItems).where({ document_ID: document.ID })
          );
          console.log(`🔄 Deleted ${existingLineItems.length} existing line items`);
        }

        // Store line items
        if (lineItems.length > 0) {
          const lineMapping = {
            'description': 'description',
            'quantity': 'quantity',
            'unitPrice': 'unitPrice',
            'netAmount': 'lineAmount',
            'lineAmount': 'lineAmount',
            'materialNumber': 'materialNumber',
            'poLineItem': 'poLineItem',
            'purchaseOrderItemNumber': 'poLineItem'
          };

          const lineItemsData = [];
          lineItems.forEach((lineItem, index) => {
            const itemData = {
              document_ID: document.ID,
              lineNumber: lineItem.occurrence || (index + 1)
            };

            lineItem.fields.forEach(field => {
              const targetField = lineMapping[field.name];
              if (targetField) {
                // Set value based on data type
                if (field.dataType === 'Number') {
                  itemData[targetField] = field.numberValue;
                } else if (field.dataType === 'Date') {
                  itemData[targetField] = field.dateValue;
                } else {
                  itemData[targetField] = field.stringValue;
                }

                // Set confidence
                itemData[`${targetField}_confidence`] = field.confidence || 0;
              }
            });

            lineItemsData.push(itemData);
          });

          await cds.run(INSERT.into(InvoiceLineItems).entries(lineItemsData));
          console.log(`✅ ${lineItems.length} invoice line items stored successfully`);
        } else {
          console.log('⚠️  No line items found in extraction');
        }

        // Set status to 'extracted' when data is available
        statusUpdate.status = 'extracted';
        statusUpdate.extractionStatus = NotificationTargetStatus;
      } else {
        console.log('⚠️  No DocumentResult found in payload - status recorded only');
      }

      // Update document status
      await cds.run(UPDATE(Documents, document.ID).with(statusUpdate));
      console.log(`✅ Document status updated to: ${statusUpdate.status} / ${statusUpdate.extractionStatus}`);


      console.log('=== Callback Processing Complete ===\n');

      return "Callback processed successfully";
    } catch (error) {
      console.error('\n❌ Error processing DocAI callback:');
      console.error(`   Message: ${error.message}`);
      console.error(`   Stack trace: ${error.stack}`);

      // Return success to DocAI to prevent retry loops
      return `Callback received but processing failed: ${error.message}`;
    }
  });

});
