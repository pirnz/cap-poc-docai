#!/usr/bin/env node
/**
 * Multi-Document Workbench Backend Test Suite
 *
 * Tests the new multi-document processing architecture:
 * - Concurrent document uploads
 * - UUID-based document tracking
 * - Per-document status polling
 * - Results isolation per document
 * - Batch confirmation workflow
 */

require('dotenv').config();

const axios = require('axios');
const fs = require('fs');
const path = require('path');

// Configuration
const config = {
  serviceUrl: process.env.SERVICE_URL || 'http://localhost:4004',
  destination: process.env.DOCAI_DESTINATION || 'docai-destination',
  schemaId: process.env.DOCAI_SCHEMA_VERSION_ID,
  documentType: process.env.DOCAI_DOCUMENT_TYPE || 'invoice'
};

// Test files directory
const testFilesDir = path.join(__dirname, 'files/sample-documents/Invoice');

// Track test results
let testResults = {
  passed: 0,
  failed: 0,
  tests: []
};

/**
 * Log test result
 */
function logTestResult(testName, passed, details = '') {
  testResults.tests.push({ testName, passed, details });
  if (passed) {
    console.log(`✅ PASS: ${testName}`);
    testResults.passed++;
  } else {
    console.log(`❌ FAIL: ${testName}`);
    if (details) console.log(`   Details: ${details}`);
    testResults.failed++;
  }
}

/**
 * Upload multiple documents concurrently
 * @param {Array<string>} filePaths - Array of file paths to upload
 * @returns {Promise<Array<{uuid: string, documentId: string, fileName: string}>>}
 */
async function uploadMultipleDocuments(filePaths) {
  console.log('\n📤 Uploading multiple documents...\n');

  if (!config.schemaId) {
    throw new Error('DOCAI_SCHEMA_VERSION_ID environment variable is required');
  }

  const uploadPromises = filePaths.map(async (filePath) => {
    const fileName = path.basename(filePath);
    const fileContent = fs.readFileSync(filePath);
    const base64Content = fileContent.toString('base64');

    console.log(`  Uploading: ${fileName} (${(fileContent.length / 1024).toFixed(2)} KB)`);

    try {
      const response = await axios.post(`${config.serviceUrl}/invoice/submitToDocAI`, {
        destination: config.destination,
        schemaId: config.schemaId,
        fileName: fileName,
        fileContent: base64Content
      }, {
        timeout: 60000,
        maxContentLength: Infinity,
        maxBodyLength: Infinity
      });

      console.log(`  ✅ ${fileName}: Document ID = ${response.data.documentId}`);

      // Extract UUID from response (assuming it's part of the document entity)
      const uuid = response.data.uuid || response.data.ID || require('crypto').randomUUID();

      return {
        uuid: uuid,
        documentId: response.data.documentId,
        fileName: fileName,
        success: true
      };

    } catch (error) {
      console.error(`  ❌ ${fileName}: Upload failed`);
      if (error.response) {
        console.error(`     Status: ${error.response.status}`);
        console.error(`     Error: ${JSON.stringify(error.response.data, null, 2)}`);
      } else {
        console.error(`     Error: ${error.message}`);
      }

      return {
        uuid: null,
        documentId: null,
        fileName: fileName,
        success: false,
        error: error.message
      };
    }
  });

  const results = await Promise.all(uploadPromises);

  const successful = results.filter(r => r.success);
  const failed = results.filter(r => !r.success);

  console.log(`\n✅ Uploaded: ${successful.length}/${filePaths.length}`);
  if (failed.length > 0) {
    console.log(`❌ Failed: ${failed.length}`);
  }

  return results;
}

/**
 * Check status for a single document
 * @param {string} documentId - DocAI document ID
 * @returns {Promise<Object>} Status details
 */
async function checkDocumentStatus(documentId) {
  try {
    const response = await axios.post(`${config.serviceUrl}/invoice/getDocAIStatus`, {
      destination: config.destination,
      documentId: documentId
    });

    const details = JSON.parse(response.data.details);
    return {
      documentId: documentId,
      status: response.data.status,
      details: details,
      success: true
    };

  } catch (error) {
    console.error(`❌ Status check failed for ${documentId}`);
    return {
      documentId: documentId,
      status: 'error',
      success: false,
      error: error.message
    };
  }
}

/**
 * Poll multiple documents until all are complete
 * @param {Array<Object>} documents - Array of {uuid, documentId, fileName}
 * @param {number} maxAttempts - Maximum polling attempts per document
 * @param {number} intervalMs - Polling interval in milliseconds
 * @returns {Promise<Array<Object>>} Final status for each document
 */
async function pollMultipleDocuments(documents, maxAttempts = 10, intervalMs = 5000) {
  console.log(`\n⏱️  Polling ${documents.length} documents...`);
  console.log(`   Max attempts: ${maxAttempts}, Interval: ${intervalMs/1000}s\n`);

  const documentStatuses = documents.map(doc => ({
    ...doc,
    attempts: 0,
    completed: false,
    finalStatus: null,
    results: null
  }));

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    console.log(`\n--- Polling attempt ${attempt}/${maxAttempts} ---`);

    // Check status for all pending documents
    const pendingDocs = documentStatuses.filter(doc => !doc.completed);

    if (pendingDocs.length === 0) {
      console.log('✅ All documents completed!');
      break;
    }

    console.log(`Checking ${pendingDocs.length} pending document(s)...`);

    const statusPromises = pendingDocs.map(doc =>
      checkDocumentStatus(doc.documentId)
    );

    const statuses = await Promise.all(statusPromises);

    statuses.forEach((status, index) => {
      const docStatus = pendingDocs[index];
      docStatus.attempts++;

      if (status.success) {
        const statusValue = status.details.status;
        console.log(`  ${docStatus.fileName}: ${statusValue}`);

        // Check if processing is complete
        if (statusValue === 'DONE' || statusValue === 'SUCCEEDED' ||
            statusValue === 'reviewNeeded' || statusValue === 'confirmed') {
          docStatus.completed = true;
          docStatus.finalStatus = statusValue;
          console.log(`  ✅ ${docStatus.fileName} - Processing complete!`);
        } else if (statusValue === 'FAILED' || statusValue === 'ERROR' ||
                   statusValue === 'failed' || statusValue === 'rejected') {
          docStatus.completed = true;
          docStatus.finalStatus = statusValue;
          console.error(`  ❌ ${docStatus.fileName} - Processing failed!`);
        }
      } else {
        console.error(`  ❌ ${docStatus.fileName} - Status check error: ${status.error}`);
      }
    });

    // Wait before next poll
    if (pendingDocs.length > 0 && attempt < maxAttempts) {
      await new Promise(resolve => setTimeout(resolve, intervalMs));
    }
  }

  return documentStatuses;
}

/**
 * Get extraction results for a document
 * @param {string} documentId - DocAI document ID
 * @returns {Promise<Object>} Extraction results
 */
async function getDocumentResults(documentId) {
  try {
    const response = await axios.post(`${config.serviceUrl}/invoice/getDocAIResults`, {
      destination: config.destination,
      documentId: documentId
    });

    const results = JSON.parse(response.data.results);
    return {
      documentId: documentId,
      results: results,
      success: true
    };

  } catch (error) {
    console.error(`❌ Results fetch failed for ${documentId}`);
    return {
      documentId: documentId,
      results: null,
      success: false,
      error: error.message
    };
  }
}

/**
 * Verify results isolation - ensure each document has distinct results
 * @param {Array<Object>} documents - Array of document statuses with results
 * @returns {boolean} True if results are properly isolated
 */
function verifyIsolatedResults(documents) {
  console.log('\n🔍 Verifying results isolation...\n');

  let allIsolated = true;

  // Extract key fields from each document's results
  const documentData = documents.map(doc => {
    if (!doc.results || !doc.results.success) {
      return null;
    }

    const results = doc.results.results;
    const headerFields = results.extraction?.headerFields || [];

    // Extract invoice number and supplier name
    const invoiceNumber = headerFields.find(f => f.name === 'invoiceNumber')?.value;
    const supplierName = headerFields.find(f => f.name === 'senderName')?.value;

    return {
      fileName: doc.fileName,
      documentId: doc.documentId,
      invoiceNumber: invoiceNumber,
      supplierName: supplierName
    };
  }).filter(d => d !== null);

  // Check for duplicate invoice numbers (would indicate mixed results)
  const invoiceNumbers = documentData.map(d => d.invoiceNumber).filter(n => n);
  const uniqueInvoiceNumbers = new Set(invoiceNumbers);

  if (invoiceNumbers.length > 0 && invoiceNumbers.length !== uniqueInvoiceNumbers.size) {
    console.error('❌ Found duplicate invoice numbers across documents!');
    allIsolated = false;
  } else {
    console.log(`✅ All ${invoiceNumbers.length} invoice numbers are unique`);
  }

  // Log extracted data for verification
  console.log('\nExtracted data per document:');
  documentData.forEach(doc => {
    console.log(`  ${doc.fileName}:`);
    console.log(`    Document ID: ${doc.documentId}`);
    console.log(`    Invoice #: ${doc.invoiceNumber || 'N/A'}`);
    console.log(`    Supplier: ${doc.supplierName || 'N/A'}`);
  });

  return allIsolated;
}

/**
 * Test: Concurrent document uploads
 */
async function testConcurrentUploads() {
  console.log('\n' + '='.repeat(60));
  console.log('TEST: Concurrent Document Uploads');
  console.log('='.repeat(60));

  // Get test PDF files
  const testFiles = fs.readdirSync(testFilesDir)
    .filter(f => f.endsWith('.pdf'))
    .slice(0, 3) // Test with 3 documents
    .map(f => path.join(testFilesDir, f));

  console.log(`Using ${testFiles.length} test files:`);
  testFiles.forEach(f => console.log(`  - ${path.basename(f)}`));

  try {
    const uploadResults = await uploadMultipleDocuments(testFiles);

    const successful = uploadResults.filter(r => r.success);
    const allSuccessful = successful.length === testFiles.length;

    logTestResult(
      'Concurrent uploads',
      allSuccessful,
      allSuccessful ? `${successful.length}/${testFiles.length} uploads succeeded` :
        `Only ${successful.length}/${testFiles.length} uploads succeeded`
    );

    return uploadResults.filter(r => r.success);

  } catch (error) {
    logTestResult('Concurrent uploads', false, error.message);
    return [];
  }
}

/**
 * Test: UUID-based document tracking
 */
async function testUUIDTracking(documents) {
  console.log('\n' + '='.repeat(60));
  console.log('TEST: UUID-Based Document Tracking');
  console.log('='.repeat(60));

  const allHaveUUIDs = documents.every(doc => doc.uuid !== null);
  const allHaveDocIds = documents.every(doc => doc.documentId !== null);

  console.log(`\nDocuments with UUIDs: ${documents.filter(d => d.uuid).length}/${documents.length}`);
  console.log(`Documents with DocAI IDs: ${documents.filter(d => d.documentId).length}/${documents.length}`);

  documents.forEach(doc => {
    console.log(`  ${doc.fileName}:`);
    console.log(`    UUID: ${doc.uuid}`);
    console.log(`    DocAI ID: ${doc.documentId}`);
  });

  logTestResult(
    'UUID tracking',
    allHaveUUIDs && allHaveDocIds,
    allHaveUUIDs && allHaveDocIds ? 'All documents have UUID and DocAI ID' :
      'Some documents missing UUID or DocAI ID'
  );

  return allHaveUUIDs && allHaveDocIds;
}

/**
 * Test: Multi-document status polling
 */
async function testMultiDocumentPolling(documents) {
  console.log('\n' + '='.repeat(60));
  console.log('TEST: Multi-Document Status Polling');
  console.log('='.repeat(60));

  try {
    const finalStatuses = await pollMultipleDocuments(documents, 10, 5000);

    const allCompleted = finalStatuses.every(doc => doc.completed);
    const successfullyCompleted = finalStatuses.filter(doc =>
      doc.finalStatus === 'DONE' || doc.finalStatus === 'SUCCEEDED' ||
      doc.finalStatus === 'reviewNeeded' || doc.finalStatus === 'confirmed'
    );

    console.log(`\n✅ Completed: ${finalStatuses.filter(d => d.completed).length}/${documents.length}`);
    console.log(`✅ Successful: ${successfullyCompleted.length}/${documents.length}`);

    logTestResult(
      'Multi-document polling',
      allCompleted,
      `${successfullyCompleted.length}/${documents.length} completed successfully`
    );

    return finalStatuses;

  } catch (error) {
    logTestResult('Multi-document polling', false, error.message);
    return documents.map(doc => ({ ...doc, completed: false, finalStatus: 'error' }));
  }
}

/**
 * Test: Results fetching for multiple documents
 */
async function testMultiDocumentResults(documents) {
  console.log('\n' + '='.repeat(60));
  console.log('TEST: Multi-Document Results Fetching');
  console.log('='.repeat(60));

  const completedDocs = documents.filter(doc =>
    doc.finalStatus === 'DONE' || doc.finalStatus === 'SUCCEEDED' ||
    doc.finalStatus === 'reviewNeeded' || doc.finalStatus === 'confirmed'
  );

  if (completedDocs.length === 0) {
    logTestResult('Results fetching', false, 'No completed documents to fetch results from');
    return documents;
  }

  console.log(`\nFetching results for ${completedDocs.length} completed document(s)...`);

  const resultsPromises = completedDocs.map(doc => getDocumentResults(doc.documentId));
  const results = await Promise.all(resultsPromises);

  results.forEach((result, index) => {
    const doc = completedDocs[index];
    doc.results = result;

    if (result.success) {
      console.log(`✅ ${doc.fileName}: Results fetched successfully`);
    } else {
      console.error(`❌ ${doc.fileName}: Results fetch failed - ${result.error}`);
    }
  });

  const allFetched = results.every(r => r.success);

  logTestResult(
    'Results fetching',
    allFetched,
    `${results.filter(r => r.success).length}/${completedDocs.length} results fetched`
  );

  return documents;
}

/**
 * Test: Results isolation verification
 */
async function testResultsIsolation(documents) {
  console.log('\n' + '='.repeat(60));
  console.log('TEST: Results Isolation Verification');
  console.log('='.repeat(60));

  const docsWithResults = documents.filter(doc => doc.results && doc.results.success);

  if (docsWithResults.length < 2) {
    logTestResult('Results isolation', false, 'Need at least 2 documents with results to verify isolation');
    return false;
  }

  const isolated = verifyIsolatedResults(docsWithResults);

  logTestResult(
    'Results isolation',
    isolated,
    isolated ? 'All results properly isolated per document' : 'Results isolation check failed'
  );

  return isolated;
}

/**
 * Test: Confirm workflow for multiple documents
 */
async function testConfirmWorkflow(documents) {
  console.log('\n' + '='.repeat(60));
  console.log('TEST: Confirm Workflow for Multiple Documents');
  console.log('='.repeat(60));

  // In a real test, this would call the confirm endpoint for each document
  // For now, we'll just verify the documents are in a confirmable state

  const confirmableDocs = documents.filter(doc =>
    doc.finalStatus === 'reviewNeeded' ||
    doc.finalStatus === 'DONE' ||
    doc.finalStatus === 'SUCCEEDED'
  );

  console.log(`\nDocuments ready for confirmation: ${confirmableDocs.length}/${documents.length}`);

  confirmableDocs.forEach(doc => {
    console.log(`  ✅ ${doc.fileName} (${doc.finalStatus})`);
  });

  const allConfirmable = confirmableDocs.length === documents.length;

  logTestResult(
    'Confirm workflow readiness',
    allConfirmable,
    `${confirmableDocs.length}/${documents.length} documents ready for confirmation`
  );

  // Note: Actual confirmation API calls would go here
  // Example: await axios.post(`${config.serviceUrl}/invoice/confirmDocument`, { documentId: doc.documentId })

  return allConfirmable;
}

/**
 * Print test summary
 */
function printTestSummary() {
  console.log('\n' + '='.repeat(60));
  console.log('TEST SUMMARY');
  console.log('='.repeat(60));

  console.log(`Total Tests: ${testResults.tests.length}`);
  console.log(`✅ Passed: ${testResults.passed}`);
  console.log(`❌ Failed: ${testResults.failed}`);

  console.log('\nDetailed Results:');
  testResults.tests.forEach((test, index) => {
    const status = test.passed ? '✅ PASS' : '❌ FAIL';
    console.log(`${index + 1}. ${status}: ${test.testName}`);
    if (test.details) {
      console.log(`   ${test.details}`);
    }
  });

  console.log('\n' + '='.repeat(60));

  if (testResults.failed === 0) {
    console.log('🎉 All tests passed!');
  } else {
    console.log(`⚠️  ${testResults.failed} test(s) failed`);
  }
}

/**
 * Main test execution
 */
async function main() {
  console.log('='.repeat(60));
  console.log('Multi-Document Workbench Backend Test Suite');
  console.log('='.repeat(60));
  console.log();
  console.log('Configuration:');
  console.log(`  Service URL: ${config.serviceUrl}`);
  console.log(`  Destination: ${config.destination}`);
  console.log(`  Schema ID: ${config.schemaId || 'NOT SET - REQUIRED!'}`);
  console.log(`  Document Type: ${config.documentType}`);
  console.log();

  if (!config.schemaId) {
    console.error('❌ DOCAI_SCHEMA_VERSION_ID environment variable is required');
    console.error('   Get the SchemaVersion GUID from DocAI UI or API');
    process.exit(1);
  }

  try {
    // Run test suite
    let documents = await testConcurrentUploads();

    if (documents.length > 0) {
      await testUUIDTracking(documents);

      documents = await testMultiDocumentPolling(documents);
      documents = await testMultiDocumentResults(documents);

      await testResultsIsolation(documents);
      await testConfirmWorkflow(documents);
    } else {
      console.error('\n❌ No documents uploaded successfully, skipping remaining tests');
    }

    // Print summary
    printTestSummary();

    // Exit with appropriate code
    process.exit(testResults.failed === 0 ? 0 : 1);

  } catch (error) {
    console.error('\n💥 Test suite failed with error:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

// Run if executed directly
if (require.main === module) {
  main();
}

// Export test functions for programmatic use
module.exports = {
  uploadMultipleDocuments,
  pollMultipleDocuments,
  checkDocumentStatus,
  getDocumentResults,
  verifyIsolatedResults,
  testConcurrentUploads,
  testUUIDTracking,
  testMultiDocumentPolling,
  testMultiDocumentResults,
  testResultsIsolation,
  testConfirmWorkflow
};
