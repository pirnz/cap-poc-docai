/**
 * Callback Service Implementation
 *
 * Handles DocAI callbacks and stores extraction results for any schema type.
 * Schema-agnostic design: works with invoices, purchase orders, delivery notes, etc.
 */

const cds = require('@sap/cds');

module.exports = cds.service.impl(async function() {
  const { Documents, InvoiceHeader, InvoiceLineItems } = this.entities;

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
      const payload = req.data.payload || req.data || rawBody;

      if (typeof payload === 'string') {
        try {
          payload = JSON.parse(payload);
        } catch (e) {
          console.log('[DEBUG] Payload is not JSON string, using as-is');
        }
      }

      // Extract notification fields
      const {
        NotificationObjectId,
        NotificationTargetStatus,
        DocumentResult
      } = payload || {};

      console.log(`📄 Document ID: ${NotificationObjectId}`);
      console.log(`📊 Status: ${NotificationTargetStatus}`);

      // Only process confirmed extractions
      if (NotificationTargetStatus === 'confirmed' && DocumentResult) {
        console.log('✓ Status is confirmed, processing extraction...');

        // Parse DocumentResult
        const documentResult = typeof DocumentResult === 'string'
          ? JSON.parse(DocumentResult)
          : DocumentResult;

        // Find document in database by DocAI document ID
        const documents = await SELECT.from(Documents)
          .where({ docaiDocumentId: NotificationObjectId });

        if (!documents || documents.length === 0) {
          console.log(`⚠️  No document found with DocAI ID: ${NotificationObjectId}`);
          return "Document not found in database";
        }

        const document = documents[0];
        console.log(`📋 Found document: ${document.ID} (${document.fileName})`);

        // Extract entities from latest version
        const versions = documentResult.documentVersions || documentResult.versions || [];

        if (versions.length === 0) {
          console.log('⚠️  No versions found in DocumentResult');
          await UPDATE(Documents, document.ID).with({
            status: 'failed',
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

        // Store invoice header
        await INSERT.into(InvoiceHeader).entries(headerData);
        console.log('✅ Invoice header stored successfully');

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

          await INSERT.into(InvoiceLineItems).entries(lineItemsData);
          console.log(`✅ ${lineItems.length} invoice line items stored successfully`);
        } else {
          console.log('⚠️  No line items found in extraction');
        }

        // Update document status
        await UPDATE(Documents, document.ID).with({
          status: 'extracted',
          extractionStatus: 'DONE'
        });

        console.log('✅ Document status updated to extracted');

      } else if (!DocumentResult) {
        console.log('⚠️  No DocumentResult found in payload');
      } else {
        console.log(`⚠️  Document status is '${NotificationTargetStatus}', expected 'confirmed' - skipping storage`);
      }

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
