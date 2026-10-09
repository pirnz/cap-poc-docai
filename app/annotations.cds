using UIService from '../srv/ui-service';

// Annotations for ProcessingBatches List Report
annotate UIService.ProcessingBatches with @(
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
annotate UIService.ProcessingBatches with @(
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
annotate UIService.Documents with @(
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
      Action: 'UIService.processDocument',
      Label: 'Process Document'
    },
    {
      $Type: 'UI.DataFieldForAction',
      Action: 'UIService.validateDocument',
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
annotate UIService.Documents with @(
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

// Annotations for ValidationResults
annotate UIService.ValidationResults with @(
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
