/**
 * DocAI Parser - Multi-version entity extraction with confidence tracking
 * Based on SAP DocAI Workshop implementation
 */

/**
 * Format date value from DocAI
 * @param {String|Array} dateValue - ISO string or [year, month, day] array
 * @returns {String|null} ISO date string
 */
function formatDateValue(dateValue) {
  if (!dateValue) return null;
  if (typeof dateValue === 'string') return dateValue;
  if (Array.isArray(dateValue)) {
    const [year, month, day] = dateValue;
    return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }
  return null;
}

/**
 * Extract typed value based on dataType
 * @param {Object} entity - DocAI entity
 * @returns {*} Typed value
 */
function extractTypedValue(entity) {
  if (!entity) return null;

  switch (entity.dataType) {
    case 'String':
      return entity.stringValue || null;
    case 'Number':
      return entity.numberValue || null;
    case 'Date':
      return formatDateValue(entity.dateValue);
    default:
      return entity.rawValue || null;
  }
}

/**
 * Find entities by name across all versions
 * @param {Array} entities - Flat array of all entities
 * @param {String} fieldName - Field name to search
 * @param {String|null} parentId - Optional parent ID for nested fields
 * @returns {Array} Matching entities
 */
function findEntity(entities, fieldName, parentId = null) {
  return entities.filter(e =>
    e.name === fieldName &&
    (parentId ? e.parent_ID === parentId : !e.parent_ID)
  );
}

/**
 * Get confirmed value with confidence (signedOff or highest confidence)
 * @param {Array} entities - Entities with same name
 * @returns {Object} { value, confidence }
 */
function getConfirmedValue(entities) {
  if (!entities || entities.length === 0) {
    return { value: null, confidence: 0 };
  }

  // Priority 1: signedOff=true, sorted by createdAt DESC
  const confirmed = entities
    .filter(e => e.signedOff === true)
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))[0];

  if (confirmed) {
    return {
      value: extractTypedValue(confirmed),
      confidence: confirmed.confidence || 0
    };
  }

  // Priority 2: Highest confidence
  const best = entities.sort((a, b) =>
    (b.confidence || 0) - (a.confidence || 0))[0];

  return {
    value: extractTypedValue(best),
    confidence: best.confidence || 0
  };
}

/**
 * Parse line items using occurrence-based strategy
 * @param {Array} entities - All entities
 * @param {String} tableId - Parent table ID
 * @returns {Array} Array of line item objects
 */
function parseOccurrenceBasedTable(entities, tableId) {
  const lineItemFields = entities.filter(e =>
    e.parent_ID === tableId && e.occurrence !== undefined
  );

  if (lineItemFields.length === 0) return [];

  // Group by occurrence
  const occurrenceMap = {};
  lineItemFields.forEach(field => {
    const occ = field.occurrence;
    if (!occurrenceMap[occ]) {
      occurrenceMap[occ] = [];
    }
    occurrenceMap[occ].push(field);
  });

  // Build line items
  const lineItems = [];
  Object.keys(occurrenceMap).sort((a, b) => a - b).forEach(occ => {
    const fields = occurrenceMap[occ];
    const lineItem = {
      lineNumber: parseInt(occ),
      description: null,
      description_confidence: 0,
      quantity: null,
      quantity_confidence: 0,
      unitPrice: null,
      unitPrice_confidence: 0,
      lineAmount: null,
      lineAmount_confidence: 0,
      materialNumber: null,
      materialNumber_confidence: 0,
      poLineItem: null,
      poLineItem_confidence: 0
    };

    // Map field names to line item properties
    const fieldMapping = {
      'description': 'description',
      'quantity': 'quantity',
      'unitPrice': 'unitPrice',
      'netAmount': 'lineAmount',
      'lineAmount': 'lineAmount',
      'materialNumber': 'materialNumber',
      'purchaseOrderItemNumber': 'poLineItem',
      'poLineItem': 'poLineItem'
    };

    fields.forEach(field => {
      const mappedField = fieldMapping[field.name];
      if (mappedField) {
        lineItem[mappedField] = extractTypedValue(field);
        lineItem[`${mappedField}_confidence`] = field.confidence || 0;
      }
    });

    lineItems.push(lineItem);
  });

  return lineItems;
}

/**
 * Parse line items using row-based strategy (fallback)
 * @param {Array} entities - All entities
 * @param {String} tableId - Parent table ID
 * @returns {Array} Array of line item objects
 */
function parseRowBasedTable(entities, tableId) {
  const tableEntity = entities.find(e => e.id === tableId);
  if (!tableEntity || !tableEntity.children) return [];

  const lineItems = [];
  tableEntity.children.forEach((rowId, index) => {
    const rowFields = entities.filter(e => e.parent_ID === rowId);

    const lineItem = {
      lineNumber: index + 1,
      description: null,
      description_confidence: 0,
      quantity: null,
      quantity_confidence: 0,
      unitPrice: null,
      unitPrice_confidence: 0,
      lineAmount: null,
      lineAmount_confidence: 0,
      materialNumber: null,
      materialNumber_confidence: 0,
      poLineItem: null,
      poLineItem_confidence: 0
    };

    const fieldMapping = {
      'description': 'description',
      'quantity': 'quantity',
      'unitPrice': 'unitPrice',
      'netAmount': 'lineAmount',
      'lineAmount': 'lineAmount',
      'materialNumber': 'materialNumber',
      'purchaseOrderItemNumber': 'poLineItem',
      'poLineItem': 'poLineItem'
    };

    rowFields.forEach(field => {
      const mappedField = fieldMapping[field.name];
      if (mappedField) {
        lineItem[mappedField] = extractTypedValue(field);
        lineItem[`${mappedField}_confidence`] = field.confidence || 0;
      }
    });

    lineItems.push(lineItem);
  });

  return lineItems;
}

/**
 * Parse line items (supports both occurrence-based and row-based)
 * @param {Array} entities - All entities
 * @returns {Array} Array of line item objects
 */
function parseLineItems(entities) {
  const tableEntity = entities.find(e =>
    e.name === 'lineItems' && e.type === 'Table'
  );

  if (!tableEntity) return [];

  // Try occurrence-based first
  const occurrenceBased = entities.filter(e =>
    e.parent_ID === tableEntity.id && e.occurrence !== undefined
  );

  if (occurrenceBased.length > 0) {
    return parseOccurrenceBasedTable(entities, tableEntity.id);
  }

  // Fallback to row-based
  return parseRowBasedTable(entities, tableEntity.id);
}

/**
 * Main parser: Parse DocumentResult into structured invoice data
 * @param {Object} documentResult - DocAI DocumentResult from webhook or API
 * @returns {Object} Parsed invoice with header and line items
 */
function parseDocumentResult(documentResult) {
  // Support both webhook format (documentVersions) and API format (versions)
  const versions = documentResult.documentVersions || documentResult.versions || [];

  // Flatten ALL entities from ALL versions
  const allEntities = versions.flatMap(v => v.entities || []);

  if (allEntities.length === 0) {
    console.log('Warning: No entities found in DocumentResult');
    return null;
  }

  // Field mapping: DocAI field names → Our field names
  const fieldMapping = {
    'documentNumber': 'invoiceNumber',
    'invoiceNumber': 'invoiceNumber',
    'senderName': 'supplier',
    'supplier': 'supplier',
    'senderAddress': 'supplierAddress',
    'supplierAddress': 'supplierAddress',
    'grossAmount': 'amount',
    'amount': 'amount',
    'currency': 'currency',
    'documentDate': 'invoiceDate',
    'invoiceDate': 'invoiceDate',
    'purchaseOrderNumber': 'poNumber',
    'poNumber': 'poNumber',
    'paymentDueDate': 'dueDate',
    'dueDate': 'dueDate',
    'taxAmount': 'taxAmount',
    'netAmount': 'netAmount'
  };

  // Extract header fields
  const header = {};
  const confidenceScores = [];

  Object.keys(fieldMapping).forEach(docaiField => {
    const ourField = fieldMapping[docaiField];
    const entities = findEntity(allEntities, docaiField);

    if (entities.length > 0) {
      const { value, confidence } = getConfirmedValue(entities);
      header[ourField] = value;
      header[`${ourField}_confidence`] = confidence;

      if (confidence > 0) {
        confidenceScores.push(confidence);
      }
    }
  });

  // Calculate overall confidence
  const overallConfidence = confidenceScores.length > 0
    ? confidenceScores.reduce((sum, c) => sum + c, 0) / confidenceScores.length
    : 0;

  header.overallConfidence = overallConfidence;

  // Parse line items
  const lineItems = parseLineItems(allEntities);

  return {
    header,
    lineItems
  };
}

/**
 * Assess extraction quality
 * @param {Array} entities - All entities
 * @returns {Object} Quality metrics
 */
function assessQuality(entities) {
  const fieldsWithConfidence = entities.filter(e =>
    e.type === 'Field' && e.confidence !== undefined
  );

  const totalFields = fieldsWithConfidence.length;
  const confirmedFields = fieldsWithConfidence.filter(e => e.signedOff).length;
  const avgConfidence = totalFields > 0
    ? fieldsWithConfidence.reduce((sum, e) => sum + (e.confidence || 0), 0) / totalFields
    : 0;

  return {
    totalFields,
    confirmedFields,
    confirmationRate: totalFields > 0 ? confirmedFields / totalFields : 0,
    avgConfidence: parseFloat(avgConfidence.toFixed(4)),
    quality: avgConfidence >= 0.9 ? 'high' : avgConfidence >= 0.7 ? 'medium' : 'low'
  };
}

module.exports = {
  parseDocumentResult,
  assessQuality,
  formatDateValue,
  extractTypedValue,
  findEntity,
  getConfirmedValue
};
