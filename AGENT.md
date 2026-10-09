# Agent Development Guide

## Important: Callback-Based Architecture

**This application requires DocAI callbacks for core functionality.** DocAI sends extraction results to a publicly accessible callback URL, which means:

- Full testing requires deployment to Cloud Foundry
- Local development is limited to UI and non-callback features
- DocAI callback endpoints cannot be tested locally without tunneling

## Running the Application

### Local Development (Limited Functionality)

```bash
npm install
npx cds deploy --to sqlite
npm start
```

**What works locally:**
- UI applications (monitoring, validation, Fiori apps)
- Database operations and schema
- API endpoints (except DocAI callbacks)

**What requires deployment:**
- DocAI callback reception
- Document extraction results
- Full end-to-end document processing workflow

### Production Deployment

```bash
mbt build
cf deploy mta_archives/cap-poc-docai_1.0.0.mtar
```

After deployment, configure DocAI callback URL:
```
https://<your-app-url>/post/callback
```

## Application Structure

### Backend Services

#### UI Service (`/srv/ui-service.js`, `/srv/ui-service.cds`)
Main service for document processing and DocAI integration:
- `@path: '/ui'`
- Entities: `ProcessingBatches`, `Documents`, `ValidationResults`
- Actions: File upload, document processing, validation, DocAI integration

#### Post Service (`/srv/post-service.js`, `/srv/post-service.cds`)
Handles DocAI extraction result callbacks:
- `@path: '/post'`
- Action: `callback` - receives extraction results from DocAI
- Stores results in database with multi-version parsing

#### Enrich Service (`/srv/enrich-service.js`, `/srv/enrich-service.cds`)
Demo enrichment service for auto-validation:
- `@path: '/enrich'`
- Action: `callback` - enriches documents with business data
- Demonstrates supplier ID lookup and auto-confirmation
- Contains demo data (replace with ERP integration in production)

#### Webhook Service (`/srv/webhook-service.js`)
Legacy webhook endpoint (kept for backward compatibility):
- `@path: '/webhook'`
- Action: `docai` - alternative callback endpoint

### Data Model (`/db/schema.cds`)

**Main Entities:**
- `ProcessingBatches` - Upload sessions
- `Documents` - Individual PDF files with DocAI metadata
- `ValidationResults` - Field-level validation tracking

**Extraction Results:**
- `InvoiceHeader` - Header-level invoice data with confidence
- `InvoiceLineItems` - Line items with confidence scores

### Frontend Applications

#### 1. Monitoring Page (`/app/monitoring.html`)
- Lists all processed documents
- Shows DocAI status and extraction source
- Links to DocAI workspace and validation page
- Built with SAP UI5

#### 2. Validation Page (`/app/validation.html`)
- Displays extraction results (header fields + line items)
- Confidence indicators with color coding
- Edit field values
- Confirm or enrich documents
- PDF viewer for source document
- Built with SAP UI5

#### 3. Fiori Elements Apps
- **Batches App** (`/app/batches/`) - Processing batch management
- **Documents App** (`/app/documents/`) - Document list and details

## DocAI Integration

### Key Backend Actions

#### UI Service Actions

1. **getEnvironment** - Returns environment configuration
   - `DOCAI_UI_URL` for UI deep links

2. **uploadFile** - Upload .eml or .pdf file
   - Extracts PDFs from emails
   - Creates processing batch
   - Returns: `ProcessingBatch`

3. **processDocument** - Submit document to DocAI
   - Uploads to DocAI API
   - Creates document record
   - Returns: `{ status, message, docaiDocumentId }`

4. **getDocAIStatus** - Check processing status
   - Queries DocAI API
   - Returns: `{ status, id, createdAt, details }`

5. **getDocAIResults** - Fetch extraction results
   - Returns: `{ headerFields[], lineItems[], documentConfidence, fileData, extractionSource }`
   - Separates header fields from line items based on parent hierarchy
   - Line items grouped by occurrence

6. **updateAndConfirmDocument** - Update entities and confirm
   - Updates field values in DocAI
   - Confirms document
   - Supports instant learning flag
   - Returns: `{ success, message }`

7. **validateDocument** - Validate mandatory fields
   - Checks: invoiceNumber, supplier, amount, invoiceDate, poNumber
   - Returns: `{ isValid, missingFields[], validationDetails[] }`

8. **getAvailableSchemas** - List DocAI schemas
9. **getSchemaFields** - Get schema field definitions
10. **postSupplierInvoiceToS4** - Post invoice to SAP S/4HANA (demo)

#### Callback Service Actions

1. **callback** - Receive DocAI extraction results
   - Parses multi-version entities
   - Stores in database
   - Returns: `{ received: true, status, documentId }`

#### Enrichment Service Actions

1. **callback** - Enrich and auto-confirm
   - Looks up business data (supplier IDs)
   - Updates DocAI entities
   - Auto-confirms if validation passes
   - Demo implementation with hardcoded data

### Frontend Features

#### Extraction Results Display

**Header Information Panel:**
- Document-level fields grouped by parent entity
- Supplier info, amounts, dates, PO numbers
- Confidence scores per field
- Color-coded indicators:
  - 🟢 Green: confidence ≥ 85%
  - 🟡 Yellow: confidence 70-84%
  - 🔴 Red: confidence < 70%

**Line Items Table:**
- Columns: #, field columns (dynamic), Confidence
- Editable fields
- Average confidence per row

**Document Viewer:**
- PDF viewer with base64 data
- Image viewer for image files
- Download link for other file types

All fields are editable and changes are tracked for confirmation.

## Environment Variables

Set in `mta.yaml` for Cloud Foundry deployment:

```yaml
properties:
  DOCAI_UI_URL: https://document-information-extraction.cfapps.eu10.hana.ondemand.com/workspace
```

**Note:** No `.env` file needed. Application is designed for Cloud Foundry deployment with callback integration.

## Destination Configuration

**Required Destinations:**
- `docai-destination` - DocAI API access (OAuth2ClientCredentials)

**Auto-Created Destinations:**
- `DOC_AI_cap-poc-docai` - Callback endpoint (OAuth2)
- `srv-api` - Internal service API

## Development Workflow

### Typical Development Cycle

1. **Make Code Changes:**
   - Edit service implementations, UI, or data model
   - Changes to callback handlers require deployment to test

2. **Test Locally (Limited):**
   ```bash
   npm start
   ```
   - Test UI changes
   - Verify database schema
   - Test non-callback API endpoints

3. **Deploy to BTP for Full Testing:**
   ```bash
   mbt build
   cf deploy mta_archives/cap-poc-docai_1.0.0.mtar
   ```
   - Test DocAI callback integration
   - Verify extraction result processing
   - Test end-to-end document workflow

4. **Configure DocAI Callback:**
   - After deployment, update DocAI Outbound Channel
   - URL: `https://<your-app-url>/post/callback`
   - Authentication: OAuth2ClientCredentials (uses `DOC_AI_cap-poc-docai` destination)

### Key Integration Points

1. **DocAI → App:** Callback endpoint receives extraction results
2. **App → DocAI API:** Submit documents, check status, update entities
3. **App → DocAI UI:** Deep links from monitoring/validation pages

## Troubleshooting

**Check logs:**
```bash
cf logs cap-poc-docai-srv --recent
```

**Verify destinations:**
- BTP Cockpit → Connectivity → Destinations
- Test destination connectivity

**Database inspection:**
```bash
sqlite3 db.sqlite
.tables
SELECT * FROM com_sap_docai_Documents;
```
