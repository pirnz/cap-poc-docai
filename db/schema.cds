namespace com.sap.docai;

using { managed, cuid } from '@sap/cds/common';

entity ProcessingBatches : cuid, managed {
  fileName: String(255);
  fileType: String(10); // 'eml' or 'pdf'
  uploadedAt: Timestamp;
  status: String(20); // 'uploaded', 'extracted', 'processing', 'completed', 'failed'
  totalDocuments: Integer default 0;
  processedDocuments: Integer default 0;
  schemaId: String(255); // DocAI schema version ID
  documents: Composition of many Documents on documents.batch = $self;
}

entity Documents : cuid, managed {
  batch: Association to ProcessingBatches;
  fileName: String(255);
  fileContent: LargeBinary;
  mimeType: String(100);
  uploadedAt: Timestamp;
  status: String(20); // 'pending', 'processing', 'extracted', 'validated', 'failed'
  docaiDocumentId: String(255);
  extractionStatus: String(50);
  extractionError: String(5000);
  extractionData: LargeString; // Schema-agnostic JSON extraction from callback
  extractionSource: String(20); // 'callback' or 'api'
  schemaVersionId: String(255); // Schema version ID from DocAI
  clientId: String(255); // Client ID from DocAI
  header: Composition of one InvoiceHeader on header.document = $self;
  lineItems: Composition of many InvoiceLineItems on lineItems.document = $self;
  validationResults: Composition of many ValidationResults on validationResults.document = $self;
}

entity InvoiceHeader : cuid {
  document: Association to Documents;
  invoiceNumber: String(50);
  invoiceNumber_confidence: Decimal(5,4);
  supplier: String(255);
  supplier_confidence: Decimal(5,4);
  supplierAddress: String(5000);
  supplierAddress_confidence: Decimal(5,4);
  amount: Decimal(15,2);
  amount_confidence: Decimal(5,4);
  currency: String(3);
  currency_confidence: Decimal(5,4);
  invoiceDate: Date;
  invoiceDate_confidence: Decimal(5,4);
  poNumber: String(50);
  poNumber_confidence: Decimal(5,4);
  dueDate: Date;
  dueDate_confidence: Decimal(5,4);
  taxAmount: Decimal(15,2);
  taxAmount_confidence: Decimal(5,4);
  netAmount: Decimal(15,2);
  netAmount_confidence: Decimal(5,4);
  overallConfidence: Decimal(5,4);
}

entity InvoiceLineItems : cuid {
  document: Association to Documents;
  lineNumber: Integer;
  description: String(5000);
  description_confidence: Decimal(5,4);
  quantity: Decimal(15,3);
  quantity_confidence: Decimal(5,4);
  unitPrice: Decimal(15,2);
  unitPrice_confidence: Decimal(5,4);
  lineAmount: Decimal(15,2);
  lineAmount_confidence: Decimal(5,4);
  poLineItem: String(10);
  poLineItem_confidence: Decimal(5,4);
  materialNumber: String(50);
  materialNumber_confidence: Decimal(5,4);
}

entity ValidationResults : cuid {
  document: Association to Documents;
  fieldName: String(50);
  isValid: Boolean;
  isMandatory: Boolean;
  value: String(5000);
  confidence: Decimal(5,4);
  errorMessage: String(5000);
  validatedAt: Timestamp;
}
