# Agent Development Guide

## Running the Application

The application auto-updates and restarts during development.

```bash
cds watch --profile hybrid
```

This command:
- Starts the CAP application in development mode
- Auto-reloads on file changes
- Uses the `hybrid` profile for local development

## Application Structure

### Backend
- `/srv/invoice-service.js` - Main CAP service implementation
- `/srv/invoice-service.cds` - Service definitions
- `/db/schema.cds` - Data model

### Frontend
- `/app/docai-test.html` - DocAI v4 API test console (SAP UI5)
- `/app/index.html` - Main application entry point

## DocAI Integration

### Key Backend Actions

1. **getDocAIResults** - Fetches and structures extraction results
   - Returns: `{ headerFields: [], lineItems: [], documentConfidence: 0 }`
   - Separates header fields from line items based on parent hierarchy
   - Line items grouped by occurrence

2. **submitToDocAI** - Uploads document and creates DocAI document
3. **getDocAIStatus** - Checks document processing status
4. **updateAndConfirmDocument** - Updates entity values and confirms document

### Frontend UI Structure

The test console displays extraction results in two sections:
- **Header Information Panel**: All document-level fields (supplier, amounts, dates, etc.)
- **Line Items Panel**: Table view with columns: #, Description, Qty, Unit Price, Net Amount, Confidence

All fields are editable and changes are tracked for confirmation.
