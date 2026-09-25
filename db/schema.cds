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
  extractionData: LargeString; // Schema-agnostic JSON extraction (all fields, groups, tables)
  extractionSource: String(20); // 'callback' or 'api'
  schemaVersionId: String(255); // Schema version ID from DocAI
  clientId: String(255); // Client ID from DocAI
  validationResults: Composition of many ValidationResults on validationResults.document = $self;
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
