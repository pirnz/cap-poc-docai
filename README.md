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
- **Database**: SQLite (local and production!)
- **AI Service**: SAP Document Information Extraction (DocAI)
- **Deployment**: SAP BTP Cloud Foundry (MTA-based)

## Prerequisites for Deployment

### 1. SAP BTP Account Setup

- SAP BTP account with Cloud Foundry environment
- Cloud Foundry CLI installed (`cf` command)
- MBT Build Tool installed (`mbt` command)
- Node.js 18+ (LTS recommended)

### 2. Required BTP Services

The application requires the following service instances in your subaccount:

- **XSUAA** (service: `xsuaa`, plan: `application`), free - For authentication
- **Destination** (service: `destination`, plan: `lite`), free - For connecting to DocAI and other services
- **HTML5 Application Repository** (service: `html5-apps-repo`, plan: `app-host`), free - For hosting UI applications

These services will be created automatically during deployment via `mta.yaml`.

You will also need:

- **SAP Document AI** (plan `premium`)
- **SAP Build Workzone, standard edition** (plan `free` or `standard`)


### 3. SAP Document AI requirements

- DocAI service instance (plan _premium_) created in your BTP subaccount
- DocAI service key generated with credentials
- DocAI schema configured for invoice extraction

## Installation Steps

### 1. Clone and Install Dependencies

```bash
git clone <repository-url>
cd cap-poc-docai
npm install
```

### 2. Configure Destinations

You need to create one destination pointing to DocAI.

#### DocAI Destination

Create a destination named **`docai-destination`** with the following configuration:

```
Name: docai-destination
Type: HTTP
URL: https://<region>.doc.cloud.sap/document-ai/v1/
Authentication: OAuth2ClientCredentials
tokenServiceURL: https://<region>.authentication.sap.hana.ondemand.com/oauth/token
clientId: <from-docai-service-key>
clientSecret: <from-docai-service-key>
ProxyType: Internet
```

**To get DocAI credentials:**
1. In BTP Cockpit, go to your subaccount
2. Navigate to Services → Instances and Subscriptions
3. Find your SAP Document AI service instance
4. Create a service key or view existing service key
5. Copy `clientid`, `clientsecret`, `url`, and `uaa.url`

### 3. Configure Environment Variables

#### Update `mta.yaml` for Deployment

The `mta.yaml` file contains one environment variable for the deployed application. Configure before deployment:

**DocAI UI URL** (line 20 in `mta.yaml`):
```yaml
properties:
  DOCAI_UI_URL: https://<your-docai-instance>.<region>.doc.cloud.sap/workspace
```

Update the URL with your SAP Document AI workspace endpoint (the same URL you use to access the UI). This URL is used by the monitoring and validation UI to create deep links to DocAI workspace.

### 4. Build and Deploy

#### Build MTA Archive

```bash
mbt build
```

This creates a deployable `.mtar` file in the `mta_archives/` folder.

#### Deploy to Cloud Foundry

```bash
# Login to Cloud Foundry
cf api https://api.cf.<region>.hana.ondemand.com
cf login --sso

# Deploy the application
cf deploy mta_archives/cap-poc-docai_1.0.0.mtar
```

Replace `<region>` with your Cloud Foundry region (e.g., `eu10`, `us10`).

### 5. Configure outbound channels in SAP Document AI

After deployment, configure DocAI to with the enrich and post callbacks.

1. Get your application URL:
   ```bash
   cf app cap-poc-docai-srv
   ```

2. Endpoints:
  - **Enrich**: `https://<your-app-url>/enrich/callback` - Enrichment service that looks up supplier IDs and auto-confirms documents
  - **Post**: `https://<your-app-url>/post/callback` - Main callback service that stores extraction results in the database

Configure these as outbound channels in DocAI:
- **Type**: Webhook
- **Method**: POST
- **Authentication**: OAuth2ClientCredentials (use the `DOC_AI_cap-poc-docai` destination created automatically during deployment)

**CSRF Token Authentication:**
DocAI automatically handles CSRF token authentication:
1. Before sending a callback, DocAI first sends a HEAD request to the same URL to obtain a CSRF token
2. The application responds with the token in the `X-CSRF-Token` header
3. DocAI includes this token in the subsequent POST request
4. The application validates the token before processing the callback

No additional configuration is needed - this is handled automatically by DocAI's outbound channel.

Choose which callback to use based on your needs:
- Use **Post** for standard extraction result storage
- Use **Enrich** for demo enrichment workflow with supplier ID lookup and auto-confirmation


## Application Structure

### UI Applications

#### 0. Index (`index.html`)
- Landing page with overview of all available applications
- Links to ingestion, monitoring, and validation pages
- Displays service endpoints for reference
- Access at: `https://<your-app-url>/` or `https://<your-app-url>/index.html`

#### 1. Ingestion Page (`ingestion.html`)
- Upload documents (.eml or .pdf files)
- Select DocAI schema for processing
- View available schema versions and clients
- Submit documents to DocAI for extraction
- Monitor batch processing status
- Access at: `https://<your-app-url>/ingestion.html`

#### 2. Monitoring Page (`monitoring.html`)
- Lists all processed documents
- Shows document status and extraction source
- Provides links to DocAI workspace
- Access at: `https://<your-app-url>/monitoring.html`

#### 3. Validation Page (`validation.html`)
- View document extraction results
- Edit field values if needed
- Confirm documents
- Enrich with business data
- Access at: `https://<your-app-url>/validation.html?docId=<document-id>`


## Data Model

### Entities

- **ProcessingBatches**: Upload sessions (one .eml or .pdf file)
- **Documents**: Individual PDF files
- **InvoiceHeader**: Extracted header-level invoice data with confidence scores
- **InvoiceLineItems**: Line items from invoice with confidence scores
- **ValidationResults**: Validation status for mandatory fields


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

### UI Service (`/ui`)

Main service for document processing and UI operations:
- `GET /ui/ProcessingBatches` - List processing batches
- `GET /ui/Documents` - List documents
- `GET /ui/ValidationResults` - List validation results
- `POST /ui/uploadFile` - Upload document
- `POST /ui/processDocument` - Submit document to DocAI
- `POST /ui/validateDocument` - Validate mandatory fields
- `POST /ui/getDocAIStatus` - Check DocAI processing status
- `POST /ui/getDocAIResults` - Get extraction results
- `POST /ui/updateAndConfirmDocument` - Update and confirm document
- `POST /ui/getEnvironment` - Get environment configuration

### Post Service (`/post`)

Receives DocAI extraction callbacks:
- `POST /post/callback` - DocAI callback endpoint (stores extraction results)

### Enrich Service (`/enrich`)

Demo enrichment with auto-confirmation:
- `POST /enrich/callback` - Enrichment callback endpoint (adds supplier IDs and auto-confirms)

## Development Notes

### Key Learnings

1. **Webhook contains full extraction** - No separate GET request needed
2. **Multi-version parsing** - Search ALL versions for best value
3. **signedOff flag** - Primary indicator of human-confirmed data
4. **Typed value extraction** - Use `dataType` to determine correct field
5. **Confidence tracking** - Store confidence alongside every field


## Project Structure

```
cap-poc-docai/
├── app/
│   ├── annotations.cds            # UI annotations for Fiori Elements
│   ├── index.html                 # Landing page with app overview
│   ├── ingestion.html             # Document upload and processing
│   ├── monitoring.html            # Document list and status monitoring
│   ├── validation.html            # Document validation and editing
│   └── manifest.json              # App configuration
├── db/
│   └── schema.cds                 # Data model (Documents, ProcessingBatches, etc.)
├── srv/
│   ├── ui-service.cds             # UI service definitions
│   ├── ui-service.js              # Main service implementation
│   ├── post-service.cds           # Post callback service definitions
│   ├── post-service.js            # Callback handler for extraction results
│   ├── enrich-service.cds         # Enrich callback service definitions
│   ├── enrich-service.js          # Enrichment handler with supplier lookup
│   ├── webhook-service.js         # Legacy webhook handler
│   ├── server.js                  # Express middleware configuration
│   └── utils/
│       ├── docai-parser.js        # Multi-version entity parser
│       └── payload-normalizer.js  # Payload format handler
├── mta.yaml                       # MTA deployment descriptor
├── package.json                   # Dependencies
└── xs-security.json               # XSUAA security configuration
```

## References

- [SAP CAP Documentation](https://cap.cloud.sap/docs/)
- [SAP Document Information Extraction](https://help.sap.com/docs/document-information-extraction)
- [DocAI API Reference](https://api.sap.com/api/document_information_extraction_api)
- [SAP BTP Cloud Foundry Documentation](https://help.sap.com/docs/BTP/65de2977205c403bbc107264b8eccf4b/9c7092c7b7ae4d49bc8ae35fdd0e0b18.html)

## Support

For issues or questions:
1. Check the troubleshooting section above
2. Review application logs using `cf logs cap-poc-docai-srv`
3. Verify all destinations and services are configured correctly
4. Consult SAP BTP and DocAI documentation
