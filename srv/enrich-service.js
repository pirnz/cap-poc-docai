/**
 * Enrich Service Implementation
 *
 * Demo enrichment endpoint that validates and enriches documents
 * with supplier IDs before auto-confirming them in DocAI.
 *
 * This service demonstrates how to:
 * - Receive DocAI callbacks
 * - Look up business data (supplier IDs)
 * - Update document entities in DocAI
 * - Auto-confirm documents when validation passes
 */

const cds = require('@sap/cds');
const { parseGroovyToJson } = require('./utils/groovy-parser');

// Demo invoice data - hardcoded for PoC purposes
// In production, replace with actual ERP/master data lookups
const WORKSHOP_INVOICES = {
  'XCB-1234-0001': { poNumber: 'UKTY9988', supplierName: 'Umbro LLC', supplierID: 'SUP-001' },
  'NFI-001-00020': { poNumber: null, supplierName: 'Norsk Folkehjelp', supplierID: 'SUP-002' },
  'RC-123-321': { poNumber: 'HU/003/01/2563', supplierName: 'RC Consulting LLC', supplierID: 'SUP-003' },
  'XCB-8888-9999': { poNumber: 'UKAB89123', supplierName: 'Twitter UK', supplierID: 'SUP-004' },
  '12341234': { poNumber: 'TJ4567', supplierName: 'NOV Chinese Blogger Conference', supplierID: 'SUP-005' },
  '89993998': { poNumber: '87666545', supplierName: 'NAVFAC', supplierID: 'SUP-006' },
  '1234567': { poNumber: null, supplierName: 'guru shop', supplierID: 'SUP-007' },
  '88889999': { poNumber: null, supplierName: 'Flickr', supplierID: 'SUP-008' },
  '77775555': { poNumber: '66665555', supplierName: 'Engenharia Ambiental', supplierID: 'SUP-009' }
};

module.exports = cds.service.impl(async function() {
  /**
   * Helper: Normalize string for comparison (trim, lowercase, remove trailing commas)
   */
  function normalizeString(str) {
    if (str == null) return '';
    return String(str).trim().toLowerCase().replace(/,\s*$/, '');
  }

  /**
   * Helper: Extract field value by name from entity list
   */
  function getFieldValue(entities, fieldNames) {
    if (!entities || !Array.isArray(entities)) return null;
    if (!Array.isArray(fieldNames)) fieldNames = [fieldNames];

    for (const fieldName of fieldNames) {
      const entity = entities.find(e =>
        e.name === fieldName ||
        e.label === fieldName ||
        e.name?.toLowerCase() === fieldName.toLowerCase()
      );
      if (entity) {
        return entity.stringValue || entity.numberValue || entity.dateValue || entity.rawValue || null;
      }
    }
    return null;
  }

  /**
   * DocAI Enrichment Callback Handler
   * Pure enrichment - no local database operations
   */
  this.on('callback', async (req) => {
    try {
      console.log('\n=== DocAI Enrichment Callback Received ===');

      // Extract payload
      const rawBody = req._.req.body;
      let payload = req.data.payload || req.data || rawBody;

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
        NotificationTargetStatus
      } = payload || {};

      console.log(`📄 Document ID: ${NotificationObjectId}`);
      console.log(`📊 Status: ${NotificationTargetStatus}`);

      // Only process reviewNeeded documents
      if ((NotificationTargetStatus !== 'reviewNeeded') && (NotificationTargetStatus !== 'inProgress')) {
        console.log(`⏭️  Skipping - Status is '${NotificationTargetStatus}', not 'reviewNeeded' or 'inProgress'`);
        return "Skipped - not reviewNeeded or inProgress status";
      }

      // Fetch document from DocAI API
      const axios = require('axios');
      const { getDestination } = require('@sap-cloud-sdk/connectivity');

      const destinationName = 'docai-destination';
      const destConfig = await getDestination({ destinationName });
      const baseUrl = destConfig.url.replace(/\/$/, '');

      const authHeaders = destConfig.authTokens && destConfig.authTokens.length > 0
        ? { 'Authorization': `Bearer ${destConfig.authTokens[0].value}` }
        : {};

      console.log('[INFO] Fetching document from DocAI with expanded entities');
      const fetchUrl = `${baseUrl}/DocumentService/Documents(${NotificationObjectId})?$expand=versions($expand=entities)`;

      const docResponse = await axios.get(fetchUrl, {
        headers: {
          'Authorization': authHeaders.Authorization,
          'Accept': 'application/json'
        }
      });

      console.log(`[DEBUG] Document status: ${docResponse.data.status}`);

      const docVersions = docResponse.data.versions || [];
      if (docVersions.length === 0) {
        throw new Error('No versions found in document');
      }

      const latestDocVersion = docVersions.reduce((prev, current) =>
        (current.version > prev.version) ? current : prev
      );

      const allEntities = latestDocVersion.entities || [];
      console.log(`[DEBUG] Found ${allEntities.length} entities in latest version`);

      // Build entity map for parent lookup
      const entityMap = {};
      allEntities.forEach(entity => {
        entityMap[entity.ID] = entity;
      });

      // Helper to check if entity's parent is a Table
      function isTableField(entity) {
        if (!entity.parent_ID) return false;
        const parent = entityMap[entity.parent_ID];
        return parent && parent.type === 'Table';
      }

      // Extract header fields only (exclude line items in tables)
      const headerEntities = allEntities.filter(e => e.type === 'Field' && !isTableField(e));

      console.log(`[DEBUG] Header entities found: ${headerEntities.length}`);

      // Extract required fields
      const invoiceNumber = getFieldValue(headerEntities, ['invoiceNumber', 'documentNumber']);
      const poNumber = getFieldValue(headerEntities, ['poNumber', 'purchaseOrderNumber']);
      const supplier = getFieldValue(headerEntities, ['supplier', 'senderName']);

      console.log(`📋 Extracted - Invoice: ${invoiceNumber}, PO: ${poNumber}, Supplier: ${supplier}`);

      // Validate required fields
      if (!invoiceNumber) {
        console.log('⚠️  Missing invoice number - skipping enrichment');
        return "Skipped - missing invoice number";
      }

      // Lookup in workshop data
      const workshopData = WORKSHOP_INVOICES[invoiceNumber];
      if (!workshopData) {
        console.log(`⚠️  Invoice number '${invoiceNumber}' not in workshop data - skipping enrichment`);
        return "Skipped - not a workshop invoice";
      }

      console.log(`✅ Found workshop data for invoice: ${invoiceNumber}`);

      // Validate supplier name
      if (supplier && normalizeString(workshopData.supplierName) !== normalizeString(supplier)) {
        console.log(`⚠️  Supplier name mismatch - Expected: ${workshopData.supplierName}, Got: ${supplier}`);
      }

      // Validate PO number
      let poMatches = false;
      if (workshopData.poNumber && poNumber) {
        poMatches = normalizeString(workshopData.poNumber) === normalizeString(poNumber);
        if (!poMatches) {
          console.log(`⚠️  PO number mismatch - Expected: ${workshopData.poNumber}, Got: ${poNumber}`);
        } else {
          console.log(`✅ PO number matches: ${poNumber}`);
        }
      }

      const supplierID = workshopData.supplierID;
      console.log(`✅ Enriching with Supplier ID: ${supplierID}`);

      // Determine if document should be auto-confirmed
      // Confirm if both supplierID (found in workshop data) and PO number match
      const shouldConfirm = workshopData.supplierID && workshopData.poNumber && poNumber && poMatches;
      if (!shouldConfirm) {
        console.log(`⚠️  Not auto-confirming - PO requirements not met`);
      } else {
        console.log(`✅ Will auto-confirm - supplier ID and PO number match`);
      }

      // Update DocAI with supplier ID
      console.log('[INFO] Finding or creating supplierID entity in DocAI');

      // Find supplierID entity (search ALL entities - supplierID has a parent_ID)
      let supplierIDEntity = allEntities.find(e =>
        e.name === 'supplierID' ||
        e.name === 'supplierId' ||
        e.name === 'supplier_id' ||
        e.label === 'Supplier ID' ||
        e.label === 'SupplierID' ||
        e.name?.toLowerCase() === 'supplierid'
      );

      if (!supplierIDEntity) {
        console.log('[INFO] supplierID entity not found - creating it');

        // Find the supplier group parent
        const supplierGroup = allEntities.find(e =>
          e.name === 'supplier' || e.name === 'supplierInformation'
        );

        if (!supplierGroup) {
          throw new Error('supplier group not found in document - cannot create supplierID field');
        }

        console.log(`[INFO] Found parent group: ${supplierGroup.name} (ID: ${supplierGroup.ID})`);

        // Get schema entity ID for supplierID from SchemaService
        const schemaEntitiesUrl = `${baseUrl}/SchemaService/SchemaEntities?$filter=schemaVersion_ID eq ${docResponse.data.schemaVersion_ID} and name eq 'supplierID'`;
        const schemaEntityResp = await axios.get(schemaEntitiesUrl, {
          headers: authHeaders
        });

        const supplierIDSchemaEntity = schemaEntityResp.data.value?.[0];
        if (!supplierIDSchemaEntity) {
          throw new Error('supplierID not found in schema definition');
        }

        console.log(`[INFO] Schema entity ID: ${supplierIDSchemaEntity.ID}`);

        // Create the entity
        const createUrl = `${baseUrl}/DocumentService/DocumentEntities`;
        const createResponse = await axios.post(createUrl, {
          name: 'supplierID',
          type: 'Field',
          dataType: 'String',
          stringValue: '',
          schemaEntity_ID: supplierIDSchemaEntity.ID,
          parent_ID: supplierGroup.ID,
          documentVersion_ID: latestDocVersion.ID
        }, {
          headers: {
            'Content-Type': 'application/json',
            ...authHeaders
          }
        });

        console.log('[INFO] ✅ supplierID entity created');
        supplierIDEntity = createResponse.data;
      }

      console.log(`[INFO] Found supplierID entity: ${supplierIDEntity.ID}`);
      console.log(`[DEBUG] Current value: ${supplierIDEntity.stringValue || '(empty)'}`);

      // Update supplierID entity
      const updateUrl = `${baseUrl}/DocumentService/DocumentEntities(${supplierIDEntity.ID})`;
      console.log(`[INFO] Updating entity at: ${updateUrl}`);

      await axios.patch(updateUrl, {
        stringValue: supplierID
      }, {
        headers: {
          'Content-Type': 'application/json',
          ...authHeaders
        }
      });

      console.log('[INFO] ✅ Supplier ID updated in DocAI');

      // Confirm document if requirements met
      if (shouldConfirm) {
        const confirmUrl = `${baseUrl}/DocumentService/Documents(${NotificationObjectId})/DocumentService.confirmed`;
        console.log('[INFO] Confirming document at:', confirmUrl);

        await axios.post(confirmUrl, {
          ID: NotificationObjectId,
          useForInstantLearning: false
        }, {
          headers: {
            'Content-Type': 'application/json',
            ...authHeaders
          }
        });

        console.log('[INFO] ✅ Document confirmed in DocAI');
      }

      console.log('=== Enrichment Complete ===\n');

      return shouldConfirm
        ? `Success - Document enriched with supplier ID: ${supplierID} and confirmed`
        : `Success - Document enriched with supplier ID: ${supplierID}, not confirmed`;

    } catch (error) {
      console.error('[ERROR] Enrichment callback failed:', error.message);
      console.error('[ERROR] Stack:', error.stack);
      throw new Error(`Enrichment failed: ${error.message}`);
    }
  });
});
