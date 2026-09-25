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
  const { Documents } = db.entities('com.sap.docai');

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

        // Fetch schema to get Group/Table labels
        let schemaEntitiesMap = {};
        if (schemaVersionId) {
          try {
            console.log('[INFO] Fetching schema entities to get Group/Table labels');
            const destinationName = 'docai-destination';
            const dest = await cds.connect.to(destinationName);
            const baseUrl = dest.options.url || '';
            const schemaUrl = `${baseUrl}/SchemaService/SchemaEntities?$filter=schemaVersion_ID eq ${schemaVersionId} and (type eq 'Group' or type eq 'Table')`;

            const { executeHttpRequest } = require('./utils/http-utils');
            const schemaResponse = await executeHttpRequest(
              { destinationName },
              { method: 'GET', url: schemaUrl }
            );

            const schemaEntities = schemaResponse.data.value || [];
            console.log(`[INFO] Found ${schemaEntities.length} Groups/Tables in schema`);

            // Build map by name for lookup
            schemaEntities.forEach(entity => {
              if (entity.name) {
                schemaEntitiesMap[entity.name] = entity;
              }
            });
          } catch (schemaError) {
            console.error('[ERROR] Failed to fetch schema entities:', schemaError.message);
            // Continue without schema labels
          }
        }

        // Separate header fields and line items
        const headerFields = [];
        const lineItemGroups = {}; // Group by occurrence for line items
        const parentEntities = {}; // Store Groups and Tables metadata

        // First pass: collect Groups and Tables with labels from schema
        entities.forEach(entity => {
          if (entity.type === 'Group' || entity.type === 'Table') {
            const schemaEntity = schemaEntitiesMap[entity.name];
            parentEntities[entity.ID] = {
              ID: entity.ID,
              name: entity.name,
              label: schemaEntity?.label || entity.label || entity.name,
              type: entity.type
            };
          }
        });

        // Second pass: Process Fields
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
          parentEntities: parentEntities,
          documentConfidence: documentResult.confidenceScore || 0,
          schemaVersionId: schemaVersionId,
          clientId: clientId,
          rawPayload: documentResult
        };

        statusUpdate.extractionData = JSON.stringify(extractionData);
        statusUpdate.extractionSource = 'callback';
        console.log('[INFO] Schema-agnostic extraction data stored from callback');
        console.log(`[INFO] Stored ${headerFields.length} header fields and ${lineItems.length} line items`)

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
