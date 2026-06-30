#!/usr/bin/env node
/**
 * LEGACY SINGLE-DOCUMENT TEST
 *
 * Test for SAP Document Information Extraction API v4 (OData)
 * Uses the configured BTP destination
 *
 * NOTE: This test is for the legacy single-document workflow.
 * For multi-document workbench testing, see test-multi-document-backend.js
 */

// Load environment variables
require('dotenv').config();

const axios = require('axios');
const fs = require('fs');
const path = require('path');

// Configuration
const config = {
  serviceUrl: process.env.SERVICE_URL || 'http://localhost:4004',
  destination: process.env.DOCAI_DESTINATION || 'docai-destination',
  schemaId: process.env.DOCAI_SCHEMA_VERSION_ID, // Must be a SchemaVersion GUID, not schema name
  documentType: process.env.DOCAI_DOCUMENT_TYPE || 'invoice'
};

// Test file path
const pdfPath = path.join(__dirname, 'files/sample-documents/Invoice/chinese_blogger.pdf');

async function testConnection() {
  console.log('🔗 Testing DocAI connection...\n');

  try {
    const response = await axios.post(`${config.serviceUrl}/invoice/testDocAI`, {
      destination: config.destination
    });

    console.log('✅ Connection test successful');
    console.log(JSON.stringify(response.data, null, 2));
    return true;
  } catch (error) {
    console.error('❌ Connection test failed');
    if (error.response) {
      console.error('Status:', error.response.status);
      console.error('Data:', JSON.stringify(error.response.data, null, 2));
    } else {
      console.error('Error:', error.message);
    }
    return false;
  }
}

async function submitDocument() {
  console.log('\n📄 Submitting document to DocAI...\n');

  // Read PDF file
  const fileContent = fs.readFileSync(pdfPath);
  const fileName = path.basename(pdfPath);
  const fileSize = fileContent.length;
  const base64Content = fileContent.toString('base64');

  console.log(`File: ${fileName}`);
  console.log(`Size: ${(fileSize / 1024).toFixed(2)} KB`);
  console.log(`Destination: ${config.destination}`);
  console.log(`Schema Version ID: ${config.schemaId || 'NOT SET - REQUIRED!'}`);
  console.log(`Document Type: ${config.documentType}\n`);

  if (!config.schemaId) {
    throw new Error('DOCAI_SCHEMA_VERSION_ID environment variable is required. Get the SchemaVersion GUID from DocAI UI or API.');
  }

  try {
    const payload = {
      destination: config.destination,
      schemaId: config.schemaId,
      fileName: fileName,
      fileContent: base64Content
    };

    console.log('Request payload (without fileContent):');
    console.log(JSON.stringify({ ...payload, fileContent: `<base64 data ${base64Content.length} chars>` }, null, 2));

    const response = await axios.post(`${config.serviceUrl}/invoice/submitToDocAI`, payload, {
      timeout: 60000,
      maxContentLength: Infinity,
      maxBodyLength: Infinity
    });

    console.log('✅ Document submitted successfully!\n');
    console.log('Response:');
    console.log(JSON.stringify(response.data, null, 2));

    return response.data.documentId;

  } catch (error) {
    console.error('❌ Document submission failed\n');

    if (error.response) {
      console.error('Status:', error.response.status);
      console.error('Data:', JSON.stringify(error.response.data, null, 2));
    } else {
      console.error('Error:', error.message);
    }

    throw error;
  }
}

async function checkStatus(documentId) {
  console.log(`\n🔍 Checking status: ${documentId}\n`);

  try {
    const response = await axios.post(`${config.serviceUrl}/invoice/getDocAIStatus`, {
      destination: config.destination,
      documentId: documentId
    });

    const details = JSON.parse(response.data.details);
    console.log(`Status: ${response.data.status}`);
    console.log('\nDetails:');
    console.log(JSON.stringify(details, null, 2));

    return details;

  } catch (error) {
    console.error('❌ Status check failed');

    if (error.response) {
      console.error('Status:', error.response.status);
      console.error('Data:', JSON.stringify(error.response.data, null, 2));
    } else {
      console.error('Error:', error.message);
    }

    throw error;
  }
}

async function getResults(documentId) {
  console.log(`\n📥 Fetching extraction results: ${documentId}\n`);

  try {
    const response = await axios.post(`${config.serviceUrl}/invoice/getDocAIResults`, {
      destination: config.destination,
      documentId: documentId
    });

    const results = JSON.parse(response.data.results);
    console.log('✅ Extraction results:\n');
    console.log(JSON.stringify(results, null, 2));

    return results;

  } catch (error) {
    console.error('❌ Results fetch failed');

    if (error.response) {
      console.error('Status:', error.response.status);
      console.error('Data:', JSON.stringify(error.response.data, null, 2));
    } else {
      console.error('Error:', error.message);
    }

    throw error;
  }
}

async function pollStatus(documentId, maxAttempts = 10, intervalMs = 5000) {
  console.log(`\n⏱️  Polling status (max ${maxAttempts} attempts, ${intervalMs/1000}s interval)...\n`);

  for (let i = 0; i < maxAttempts; i++) {
    console.log(`Attempt ${i + 1}/${maxAttempts}...`);

    const status = await checkStatus(documentId);

    if (status.status === 'DONE' || status.status === 'SUCCEEDED' ||
        status.status === 'reviewNeeded' || status.status === 'confirmed') {
      console.log('\n✅ Document processing complete!');
      return await getResults(documentId);
    } else if (status.status === 'FAILED' || status.status === 'ERROR' ||
               status.status === 'failed' || status.status === 'rejected') {
      console.error('\n❌ Document processing failed');
      return status;
    } else {
      console.log(`Status: ${status.status}, waiting...`);
      await new Promise(resolve => setTimeout(resolve, intervalMs));
    }
  }

  console.log('\n⏰ Max polling attempts reached');
  return null;
}

// Main execution
async function main() {
  console.log('='.repeat(60));
  console.log('SAP Document Information Extraction API v4 Test');
  console.log('Using BTP Destination');
  console.log('='.repeat(60));
  console.log();

  try {
    // Step 1: Test connection
    const connected = await testConnection();
    if (!connected) {
      console.log('\n⚠️  Connection test failed, but continuing...');
    }

    // Step 2: Submit document
    const documentId = await submitDocument();

    if (!documentId) {
      console.log('\n⚠️  No document ID returned, stopping here');
      return;
    }

    // Step 3: Poll for completion
    console.log(`\n📝 Document ID: ${documentId}`);
    const results = await pollStatus(documentId);

    if (results) {
      console.log('\n' + '='.repeat(60));
      console.log('Final Results:');
      console.log('='.repeat(60));
      console.log(JSON.stringify(results, null, 2));
    }

    console.log('\n✅ Test completed successfully!');

  } catch (error) {
    console.error('\n💥 Test failed:', error.message);
    process.exit(1);
  }
}

// Run if executed directly
if (require.main === module) {
  main();
}

module.exports = { testConnection, submitDocument, checkStatus, getResults, pollStatus };
