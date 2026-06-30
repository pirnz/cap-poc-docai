#!/usr/bin/env node
/**
 * Process documents in a batch
 * Usage: node test/process-batch.js <batch-id>
 */

const axios = require('axios');

const host = process.env.TEST_HOST || 'localhost';
const port = process.env.TEST_PORT || 4004;
const baseUrl = `http://${host}:${port}/invoice`;

const batchId = process.argv[2];

if (!batchId) {
  console.error('\n❌ Error: Batch ID required\n');
  console.log('Usage: node test/process-batch.js <batch-id>\n');
  console.log('To find batch IDs, run:');
  console.log('  curl http://localhost:4004/invoice/ProcessingBatches | jq\n');
  process.exit(1);
}

async function processBatch() {
  console.log(`\n🔄 Processing batch: ${batchId}\n`);

  try {
    // Get batch details
    console.log('📋 Fetching batch details...');
    const batchRes = await axios.get(`${baseUrl}/ProcessingBatches(${batchId})`);
    const batch = batchRes.data;

    console.log(`   File Name: ${batch.fileName}`);
    console.log(`   File Type: ${batch.fileType}`);
    console.log(`   Total Documents: ${batch.totalDocuments}`);
    console.log(`   Current Status: ${batch.status}\n`);

    // Get documents in batch
    console.log('📄 Fetching documents...');
    const docsRes = await axios.get(`${baseUrl}/Documents?$filter=batch_ID eq ${batchId}`);
    const documents = docsRes.data.value;

    console.log(`   Found ${documents.length} document(s)\n`);

    if (documents.length === 0) {
      console.log('⚠️  No documents to process\n');
      return;
    }

    // Process each document
    console.log('🚀 Processing documents...\n');

    for (const doc of documents) {
      console.log(`   📤 ${doc.fileName}`);
      console.log(`      Document ID: ${doc.ID}`);
      console.log(`      Current Status: ${doc.status}`);

      if (doc.status !== 'pending') {
        console.log(`      ⏭️  Skipping (already ${doc.status})\n`);
        continue;
      }

      try {
        const processRes = await axios.post(`${baseUrl}/processDocument`, {
          documentId: doc.ID
        });

        const result = processRes.data;

        console.log(`      ✅ Submitted to DocAI`);
        console.log(`      DocAI Document ID: ${result.docaiDocumentId}`);
        console.log(`      Status: ${result.status}\n`);

      } catch (error) {
        console.error(`      ❌ Processing failed`);
        if (error.response) {
          console.error(`      Error: ${JSON.stringify(error.response.data, null, 2)}`);
        } else {
          console.error(`      Error: ${error.message}`);
        }
        console.log('');
      }

      // Small delay between requests
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    console.log('='.repeat(60));
    console.log('✅ Processing initiated\n');
    console.log('💡 Next Steps:');
    console.log('   1. Wait for DocAI webhook callbacks');
    console.log('   2. Or test with mock callback: node test/test-callback.js');
    console.log('   3. View results in UI: http://localhost:4004/documents/webapp/');
    console.log('   4. Verify data: node test/verify-data.js\n');

  } catch (error) {
    console.error('\n❌ Error processing batch:');
    if (error.response) {
      console.error(`   Status: ${error.response.status}`);
      console.error(`   Error: ${JSON.stringify(error.response.data, null, 2)}`);
    } else {
      console.error(`   Error: ${error.message}`);
    }
    console.log('');
    process.exit(1);
  }
}

processBatch();
