using { com.sap.docai as db } from '../db/schema';

@requires: ['system-user', 'authenticated-user']
@cds.server.body_parser.limit: '50mb'
service InvoiceProcessingService @(path: '/invoice') {

  entity ProcessingBatches as projection on db.ProcessingBatches;
  entity Documents as projection on db.Documents;
  entity InvoiceHeaders as projection on db.InvoiceHeader;
  entity InvoiceLineItems as projection on db.InvoiceLineItems;
  entity ValidationResults as projection on db.ValidationResults;

  action uploadFile(
    fileName: String,
    fileContent: LargeBinary,
    mimeType: String,
    schemaId: String
  ) returns ProcessingBatches;

  action processDocument(
    documentId: UUID
  ) returns {
    status: String;
    message: String;
    docaiDocumentId: String;
  };

  action processBatch(
    batchId: UUID
  ) returns {
    status: String;
    totalDocuments: Integer;
    processedDocuments: Integer;
    succeededDocuments: Integer;
    failedDocuments: Integer;
  };

  action validateDocument(
    documentId: UUID
  ) returns {
    isValid: Boolean;
    missingFields: array of String;
    validationDetails: array of {
      field: String;
      status: String;
      confidence: Decimal;
    };
  };

  // DocAI v4 API Test Actions
  action getAvailableSchemas() returns {
    schemas: array of {
      id: String;
      name: String;
      label: String;
      description: String;
      version: Integer;
      schemaId: String;
      clientId: String;
    };
  };

  action testDocAI() returns {
    success: Boolean;
    message: String;
    filesCount: Integer;
  };

  action submitToDocAI(
    schemaId: String,
    clientId: String,
    ocrEngine: String,
    fileName: String,
    fileContent: String
  ) returns {
    fileId: String;
    documentId: String;
    status: String;
    createdAt: String;
  };

  action getDocAIStatus(
    documentId: String
  ) returns {
    status: String;
    id: String;
    createdAt: String;
    details: LargeString;
  };

  action getDocAIResults(
    documentId: String
  ) returns {
    headerFields: array of {
      ID: String;
      name: String;
      label: String;
      dataType: String;
      stringValue: String;
      numberValue: Decimal;
      dateValue: String;
      rawValue: String;
      confidence: Decimal;
      signedOff: Boolean;
      parent_ID: String;
    };
    lineItems: array of {
      occurrence: Integer;
      fields: array of {
        ID: String;
        name: String;
        label: String;
        dataType: String;
        stringValue: String;
        numberValue: Decimal;
        dateValue: String;
        rawValue: String;
        confidence: Decimal;
        signedOff: Boolean;
      };
    };
    documentConfidence: Decimal;
    fileData: LargeString;
  };

  action pollAndProcessDocument(
    documentId: UUID
  ) returns {
    status: String;
    message: String;
    invoice: LargeString;
  };

  action processDocumentWithPolling(
    documentId: UUID,
    maxPolls: Integer,
    pollInterval: Integer
  ) returns {
    status: String;
    message: String;
    polls: Integer;
    invoice: LargeString;
  };

  // Schema Service Proxy Actions
  action getSchemaClients() returns {
    clients: array of String;
  };

  action getSchemaVersionsList() returns {
    schemaVersions: array of LargeString;
  };

  action getSchemaFields(
    schemaVersionId: String
  ) returns {
    fields: array of LargeString;
  };

  action updateAndConfirmDocument(
    documentId: String,
    entities: array of {
      entityId: String;
      stringValue: String;
      numberValue: Decimal;
      dateValue: String;
    },
    useForInstantLearning: Boolean
  ) returns {
    success: Boolean;
    message: String;
  };

  action postSupplierInvoiceToS4(
    invoiceData: {
      CompanyCode: String;
      DocumentDate: String;
      PostingDate: String;
      SupplierInvoiceIDByInvcgParty: String;
      InvoicingParty: String;
      DocumentCurrency: String;
      InvoiceGrossAmount: Decimal;
      DueCalculationBaseDate: String;
      PaymentTerms: String;
      items: array of {
        SupplierInvoiceItem: String;
        PurchaseOrder: String;
        PurchaseOrderItem: String;
        Plant: String;
        TaxCode: String;
        DocumentCurrency: String;
        SupplierInvoiceItemAmount: Decimal;
        QuantityInPurchaseOrderUnit: Decimal;
        PurchaseOrderQuantityUnit: String;
        SupplierInvoiceItemText: String;
      };
    }
  ) returns {
    SupplierInvoice: String;
    FiscalYear: String;
    success: Boolean;
    message: String;
  };
}

@cds.server.body_parser.limit: '10mb'
service WebhookService @(path: '/webhook') {
  @open
  action docai(payload: LargeString) returns { received: Boolean };
}
