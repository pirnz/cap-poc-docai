# Invoice Processing with Document AI

CAP application for processing invoice PDFs from email attachments (.eml files) or direct PDF uploads, extracting structured data using SAP Document Information Extraction (DocAI), and validating mandatory fields.

## Features

- ✅ Upload .eml (email) or .pdf files
- ✅ Extract PDF attachments from emails (including .zip files)
- ✅ Submit documents to SAP DocAI for extraction
- ✅ Webhook endpoint for DocAI callbacks (full extraction included)
- ✅ Multi-version entity parsing with confidence tracking
- ✅ Automatic validation of mandatory fields
- ✅ Comprehensive data model with confidence scores

## Architecture

- **Backend**: SAP CAP (Node.js)
- **Database**: SQLite (local) / HANA Cloud (production)
- **AI Service**: SAP Document Information Extraction (DocAI)
- **Deployment**: SAP BTP Cloud Foundry (MTA-based)

## Data Model

### Entities

- **ProcessingBatches**: Upload sessions (one .eml or .pdf file)
- **Documents**: Individual PDF files
- **InvoiceHeader**: Extracted header-level invoice data with confidence scores
- **InvoiceLineItems**: Line items from invoice with confidence scores
- **ValidationResults**: Validation status for mandatory fields

### Mandatory Fields

All invoices must have:
1. Invoice Number
2. Supplier
3. Amount
4. Invoice Date
5. PO Number

## Setup

### 1. Prerequisites

- Node.js 18+ (LTS recommended)
- SAP BTP account with DocAI service instance
- DocAI schema configured for invoice extraction

### 2. Install Dependencies

```bash
npm install
```

### 3. Configure Environment

Copy `.env.template` to `.env` and configure:

```bash
cp .env.template .env
```

Edit `.env`:

```env
DOCAI_DESTINATION=docai-destination
DOCAI_SCHEMA_ID=<your-docai-schema-id>
VALIDATION_CONFIDENCE_THRESHOLD=0.85
```

### 4. Deploy Database

```bash
npx cds deploy --to sqlite
```

### 5. Start Server

```bash
npm start
```

Server runs at `http://localhost:4004`

## UI Applications

### Access the Applications

Open your browser to: `http://localhost:4004/`

Two Fiori Elements applications are available:

#### 1. Processing Batches App
- **URL**: `http://localhost:4004/batches/webapp/index.html`
- **Purpose**: Upload and manage invoice file batches
- **Features**:
  - List all processing batches with status indicators
  - View batch details (file name, type, upload time)
  - Track document counts (total and processed)
  - Navigate to documents within each batch
  - Color-coded status (Green=completed, Yellow=processing, Red=failed)

#### 2. Invoice Documents App
- **URL**: `http://localhost:4004/documents/webapp/index.html`
- **Purpose**: View and validate invoice documents
- **Features**:
  - List all documents with extraction status
  - View invoice header data with confidence scores
  - Review line items extracted from invoices
  - Validate mandatory fields
  - Color-coded confidence indicators:
    - 🟢 Green: confidence ≥ 85%
    - 🟡 Yellow: confidence 70-84%
    - 🔴 Red: confidence < 70%
  - Process individual documents
  - Trigger validation on demand

### UI Features

**Criticality Colors**:
- Fields display with color-coded indicators based on confidence
- Mandatory field validation results show as ✅/❌
- Status fields use semantic colors (green=success, yellow=in-progress, red=error)

**Object Page Sections**:
- **Invoice Header**: All mandatory and optional header fields with confidence
- **Line Items**: Table showing all invoice line items
- **Validation Results**: Detailed validation status per field

## DocAI Integration

### Destination Configuration

Create a destination in BTP cockpit named `docai-destination`:

```yaml
Name: docai-destination
Type: HTTP
URL: https://<region>.aiservices.sap.com
Authentication: OAuth2ClientCredentials
tokenServiceURL: https://<region>.authentication.sap.hana.ondemand.com/oauth/token
clientId: <from-service-key>
clientSecret: <from-service-key>
ProxyType: Internet
```

Obtain credentials from DocAI service key in BTP cockpit.

### Webhook Configuration

Configure DocAI Outbound Channel to send extraction results to:

```
https://<your-cap-app>/webhook/docai
```

**Important**: The webhook receives the full extraction in the payload - no separate GET request needed.

### Field Mapping

Default field mapping (DocAI → CDS):

| DocAI Field | CDS Field | Type |
|-------------|-----------|------|
| documentNumber | invoiceNumber | String |
| senderName | supplier | String |
| grossAmount | amount | Decimal |
| documentDate | invoiceDate | Date |
| purchaseOrderNumber | poNumber | String |

Adjust mapping in `srv/utils/docai-parser.js` based on your DocAI schema.

## Usage

### Upload File

**POST** `/invoice/uploadFile`

```json
{
  "fileName": "invoice.pdf",
  "fileContent": "<base64-encoded-pdf>",
  "mimeType": "application/pdf"
}
```

Returns a `ProcessingBatch` with document count.

### Process Document

**POST** `/invoice/processDocument`

```json
{
  "documentId": "<uuid>"
}
```

Submits document to DocAI and returns processing status.

### Process Batch

**POST** `/invoice/processBatch`

```json
{
  "batchId": "<uuid>"
}
```

Processes all pending documents in a batch.

### Validate Document

**POST** `/invoice/validateDocument`

```json
{
  "documentId": "<uuid>"
}
```

Validates mandatory fields and returns validation results.

## Testing

### Local Testing with Mock Data

1. **Start the server**:
```bash
npm start
```

2. **Create a test document** (in another terminal):
```bash
curl -X POST http://localhost:4004/odata/v4/invoice/uploadFile \
  -H "Content-Type: application/json" \
  -d '{
    "fileName": "test-invoice.pdf",
    "fileContent": "JVBERi0xLjQK...",
    "mimeType": "application/pdf"
  }'
```

3. **Test webhook with sample callback**:
```bash
node test/test-callback.js
```

4. **Verify stored data**:
```bash
node test/verify-data.js
```

### Test Files

- `test/example-callback.json`: Sample DocAI webhook payload
- `test/test-callback.js`: Script to simulate DocAI webhook
- `test/verify-data.js`: Script to verify extraction results

## Implementation Details

### DocAI Parser (`srv/utils/docai-parser.js`)

Multi-version entity extraction following workshop best practices:

- Flattens entities from ALL document versions
- Prioritizes `signedOff: true` (human-confirmed) over confidence
- Extracts typed values based on `dataType` field
- Supports both occurrence-based and row-based table parsing
- Calculates per-field and overall confidence scores

### Webhook Handler (`srv/webhook-service.js`)

- Accepts DocAI callbacks with full extraction results
- Normalizes different payload formats
- Parses entities using multi-version strategy
- Stores extraction results with confidence scores
- Triggers automatic validation

### Validation Logic

- Checks all 5 mandatory fields for presence
- Validates confidence against threshold (default 0.85)
- Business rules:
  - Amount must be positive
  - Invoice date cannot be future-dated
- Stores validation results per field

## API Endpoints

### Invoice Processing Service

- `GET /invoice/ProcessingBatches` - List batches
- `GET /invoice/Documents` - List documents
- `GET /invoice/InvoiceHeaders` - List invoice headers
- `GET /invoice/InvoiceLineItems` - List line items
- `GET /invoice/ValidationResults` - List validation results

### Webhook Service

- `POST /webhook/docai` - DocAI callback endpoint (no auth)

## Deployment

### Cloud Foundry

1. **Build MTA**:
```bash
mbt build
```

2. **Deploy**:
```bash
cf deploy mta_archives/cap-poc-docai_1.0.0.mtar
```

3. **Configure destination** in BTP cockpit

4. **Configure DocAI Outbound Channel** with deployed app URL

## Development Notes

### Key Learnings from Workshop

1. **Webhook contains full extraction** - No separate GET request needed
2. **Multi-version parsing** - Search ALL versions for best value
3. **signedOff flag** - Primary indicator of human-confirmed data
4. **Typed value extraction** - Use `dataType` to determine correct field
5. **Confidence tracking** - Store confidence alongside every field

### Common Pitfalls

- ❌ Only looking at latest version → ✅ Flatten all versions
- ❌ Using `rawValue` → ✅ Use typed value based on `dataType`
- ❌ Ignoring `signedOff` → ✅ Prioritize human-confirmed values
- ❌ Missing parent-child relationships → ✅ Check `parent_ID` for nested fields

## Project Structure

```
cap-poc-docai/
├── app/
│   ├── annotations.cds            # UI annotations for Fiori Elements
│   ├── index.html                 # Landing page
│   ├── batches/
│   │   ├── manifest.json          # Batches app configuration
│   │   └── webapp/
│   │       ├── Component.js       # UI5 component
│   │       ├── index.html         # App entry point
│   │       └── i18n/i18n.properties
│   └── documents/
│       ├── manifest.json          # Documents app configuration
│       └── webapp/
│           ├── Component.js       # UI5 component
│           ├── index.html         # App entry point
│           └── i18n/i18n.properties
├── db/
│   └── schema.cds                 # Data model
├── srv/
│   ├── invoice-service.cds        # Service definitions
│   ├── invoice-service.js         # Main service implementation
│   ├── webhook-service.js         # DocAI webhook handler
│   ├── server.js                  # Express configuration
│   └── utils/
│       ├── docai-parser.js        # Multi-version entity parser
│       └── payload-normalizer.js  # Payload format handler
├── test/
│   ├── example-callback.json      # Sample DocAI payload
│   ├── test-callback.js           # Test webhook locally
│   └── verify-data.js             # Verify extraction results
├── mta.yaml                       # MTA deployment descriptor
├── package.json                   # Dependencies
└── .env.template                  # Environment configuration template
```

## Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| DOCAI_DESTINATION | BTP destination name | Yes |
| DOCAI_SCHEMA_ID | DocAI schema ID | Yes |
| VALIDATION_CONFIDENCE_THRESHOLD | Minimum confidence (default: 0.85) | No |

## Troubleshooting

### Webhook Not Receiving Callbacks

1. Check DocAI Outbound Channel configuration
2. Ensure webhook URL is publicly accessible
3. Check application logs for errors
4. Test webhook locally with `test-callback.js`

### Extraction Results Missing

1. Verify DocAI schema field names match parser mapping
2. Check `DocumentResult.documentVersions` in webhook payload
3. Ensure entities array is not empty
4. Review logs for parsing errors

### Validation Failures

1. Check confidence threshold in `.env`
2. Verify mandatory fields are present in extraction
3. Review business rules (positive amount, valid date)
4. Check `ValidationResults` table for details

## Next Steps

### Additional Features (Future)

- File upload UI component for batches app
- Manual correction UI for low-confidence fields
- Training feedback loop to DocAI
- Multi-language support
- Approval workflow integration
- ERP integration (SAP S/4HANA)
- Advanced analytics dashboard

## References

- [SAP CAP Documentation](https://cap.cloud.sap/docs/)
- [SAP Document Information Extraction](https://help.sap.com/docs/document-information-extraction)
- [DocAI API Reference](https://api.sap.com/api/document_information_extraction_api)
- [Project Definition](PROJECT_DEFINITION.md)
- [Implementation Notes](IMPLEMENTATION_NOTES.md)
