using InvoiceProcessingService from '../srv/invoice-service';

// Annotations for ProcessingBatches List Report
annotate InvoiceProcessingService.ProcessingBatches with @(
  UI.SelectionFields: [
    fileName,
    fileType,
    status,
    uploadedAt
  ],
  UI.LineItem: [
    {
      $Type: 'UI.DataField',
      Value: fileName,
      Label: 'File Name'
    },
    {
      $Type: 'UI.DataField',
      Value: fileType,
      Label: 'File Type'
    },
    {
      $Type: 'UI.DataField',
      Value: uploadedAt,
      Label: 'Uploaded At'
    },
    {
      $Type: 'UI.DataField',
      Value: status,
      Label: 'Status',
      Criticality: statusCriticality
    },
    {
      $Type: 'UI.DataField',
      Value: totalDocuments,
      Label: 'Total Documents'
    },
    {
      $Type: 'UI.DataField',
      Value: processedDocuments,
      Label: 'Processed'
    }
  ]
) {
  fileName @title: 'File Name';
  fileType @title: 'File Type';
  uploadedAt @title: 'Uploaded At';
  status @title: 'Status' @Common.ValueList: {
    CollectionPath: 'StatusValues',
    Parameters: [
      {
        $Type: 'Common.ValueListParameterInOut',
        LocalDataProperty: status,
        ValueListProperty: 'code'
      }
    ]
  };
  totalDocuments @title: 'Total Documents';
  processedDocuments @title: 'Processed Documents';
};

// Object Page for ProcessingBatches
annotate InvoiceProcessingService.ProcessingBatches with @(
  UI.HeaderInfo: {
    TypeName: 'Processing Batch',
    TypeNamePlural: 'Processing Batches',
    Title: {Value: fileName},
    Description: {Value: status}
  },
  UI.HeaderFacets: [
    {
      $Type: 'UI.ReferenceFacet',
      Target: '@UI.FieldGroup#Header',
      Label: 'Batch Information'
    }
  ],
  UI.FieldGroup#Header: {
    Data: [
      {Value: fileName},
      {Value: fileType},
      {Value: uploadedAt},
      {Value: status},
      {Value: totalDocuments},
      {Value: processedDocuments}
    ]
  },
  UI.Facets: [
    {
      $Type: 'UI.ReferenceFacet',
      Label: 'Documents',
      Target: 'documents/@UI.LineItem'
    }
  ]
);

// Annotations for Documents
annotate InvoiceProcessingService.Documents with @(
  UI.SelectionFields: [
    fileName,
    status,
    uploadedAt
  ],
  UI.LineItem: [
    {
      $Type: 'UI.DataField',
      Value: fileName,
      Label: 'File Name'
    },
    {
      $Type: 'UI.DataField',
      Value: uploadedAt,
      Label: 'Uploaded At'
    },
    {
      $Type: 'UI.DataField',
      Value: status,
      Label: 'Status',
      Criticality: statusCriticality
    },
    {
      $Type: 'UI.DataField',
      Value: extractionStatus,
      Label: 'Extraction Status'
    },
    {
      $Type: 'UI.DataFieldForAction',
      Action: 'InvoiceProcessingService.processDocument',
      Label: 'Process Document'
    },
    {
      $Type: 'UI.DataFieldForAction',
      Action: 'InvoiceProcessingService.validateDocument',
      Label: 'Validate'
    }
  ]
) {
  fileName @title: 'File Name';
  status @title: 'Document Status';
  extractionStatus @title: 'Extraction Status';
  uploadedAt @title: 'Uploaded At';
  docaiDocumentId @title: 'DocAI Document ID';
  extractionError @title: 'Extraction Error' @UI.MultiLineText;
};

// Object Page for Documents
annotate InvoiceProcessingService.Documents with @(
  UI.HeaderInfo: {
    TypeName: 'Document',
    TypeNamePlural: 'Documents',
    Title: {Value: fileName},
    Description: {Value: status}
  },
  UI.HeaderFacets: [
    {
      $Type: 'UI.ReferenceFacet',
      Target: '@UI.FieldGroup#DocumentInfo',
      Label: 'Document Information'
    }
  ],
  UI.FieldGroup#DocumentInfo: {
    Data: [
      {Value: fileName},
      {Value: mimeType},
      {Value: uploadedAt},
      {Value: status},
      {Value: extractionStatus},
      {Value: docaiDocumentId},
      {Value: extractionError}
    ]
  },
  UI.Facets: [
    {
      $Type: 'UI.ReferenceFacet',
      Label: 'Invoice Header',
      Target: 'header/@UI.FieldGroup#InvoiceHeader'
    },
    {
      $Type: 'UI.ReferenceFacet',
      Label: 'Line Items',
      Target: 'lineItems/@UI.LineItem'
    },
    {
      $Type: 'UI.ReferenceFacet',
      Label: 'Validation Results',
      Target: 'validationResults/@UI.LineItem'
    }
  ]
);

// Annotations for InvoiceHeader
annotate InvoiceProcessingService.InvoiceHeaders with @(
  UI.FieldGroup#InvoiceHeader: {
    Data: [
      {
        Value: invoiceNumber,
        Label: 'Invoice Number',
        Criticality: invoiceNumber_criticality
      },
      {
        Value: invoiceNumber_confidence,
        Label: 'Confidence'
      },
      {
        Value: supplier,
        Label: 'Supplier',
        Criticality: supplier_criticality
      },
      {
        Value: supplier_confidence,
        Label: 'Confidence'
      },
      {
        Value: supplierAddress,
        Label: 'Supplier Address'
      },
      {
        Value: amount,
        Label: 'Amount',
        Criticality: amount_criticality
      },
      {
        Value: amount_confidence,
        Label: 'Confidence'
      },
      {
        Value: currency,
        Label: 'Currency'
      },
      {
        Value: invoiceDate,
        Label: 'Invoice Date',
        Criticality: invoiceDate_criticality
      },
      {
        Value: invoiceDate_confidence,
        Label: 'Confidence'
      },
      {
        Value: poNumber,
        Label: 'PO Number',
        Criticality: poNumber_criticality
      },
      {
        Value: poNumber_confidence,
        Label: 'Confidence'
      },
      {
        Value: dueDate,
        Label: 'Due Date'
      },
      {
        Value: taxAmount,
        Label: 'Tax Amount'
      },
      {
        Value: netAmount,
        Label: 'Net Amount'
      },
      {
        Value: overallConfidence,
        Label: 'Overall Confidence',
        Criticality: overallConfidence_criticality
      }
    ]
  }
) {
  invoiceNumber @title: 'Invoice Number';
  supplier @title: 'Supplier';
  supplierAddress @title: 'Supplier Address' @UI.MultiLineText;
  amount @title: 'Amount';
  currency @title: 'Currency';
  invoiceDate @title: 'Invoice Date';
  poNumber @title: 'PO Number';
  dueDate @title: 'Due Date';
  taxAmount @title: 'Tax Amount';
  netAmount @title: 'Net Amount';
  overallConfidence @title: 'Overall Confidence';
};

// Annotations for InvoiceLineItems
annotate InvoiceProcessingService.InvoiceLineItems with @(
  UI.LineItem: [
    {
      $Type: 'UI.DataField',
      Value: lineNumber,
      Label: 'Line'
    },
    {
      $Type: 'UI.DataField',
      Value: description,
      Label: 'Description'
    },
    {
      $Type: 'UI.DataField',
      Value: quantity,
      Label: 'Quantity'
    },
    {
      $Type: 'UI.DataField',
      Value: unitPrice,
      Label: 'Unit Price'
    },
    {
      $Type: 'UI.DataField',
      Value: lineAmount,
      Label: 'Line Amount'
    },
    {
      $Type: 'UI.DataField',
      Value: materialNumber,
      Label: 'Material'
    },
    {
      $Type: 'UI.DataField',
      Value: poLineItem,
      Label: 'PO Line'
    }
  ]
) {
  lineNumber @title: 'Line Number';
  description @title: 'Description';
  quantity @title: 'Quantity';
  unitPrice @title: 'Unit Price';
  lineAmount @title: 'Line Amount';
  materialNumber @title: 'Material Number';
  poLineItem @title: 'PO Line Item';
};

// Annotations for ValidationResults
annotate InvoiceProcessingService.ValidationResults with @(
  UI.LineItem: [
    {
      $Type: 'UI.DataField',
      Value: fieldName,
      Label: 'Field'
    },
    {
      $Type: 'UI.DataField',
      Value: isValid,
      Label: 'Valid',
      Criticality: validationCriticality
    },
    {
      $Type: 'UI.DataField',
      Value: isMandatory,
      Label: 'Mandatory'
    },
    {
      $Type: 'UI.DataField',
      Value: value,
      Label: 'Value'
    },
    {
      $Type: 'UI.DataField',
      Value: confidence,
      Label: 'Confidence',
      Criticality: confidenceCriticality
    },
    {
      $Type: 'UI.DataField',
      Value: errorMessage,
      Label: 'Error Message'
    },
    {
      $Type: 'UI.DataField',
      Value: validatedAt,
      Label: 'Validated At'
    }
  ]
) {
  fieldName @title: 'Field Name';
  isValid @title: 'Is Valid';
  isMandatory @title: 'Is Mandatory';
  value @title: 'Value';
  confidence @title: 'Confidence';
  errorMessage @title: 'Error Message' @UI.MultiLineText;
  validatedAt @title: 'Validated At';
};
