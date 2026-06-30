const cds = require('@sap/cds');
const { parseDocumentResult, assessQuality } = require('./utils/docai-parser');
const { normalizePayload, validatePayload } = require('./utils/payload-normalizer');

module.exports = cds.service.impl(async function() {

  /**
   * DocAI webhook handler - receives full extraction results
   */
  this.on('docai', async (req) => {
    try {
      console.log('DocAI webhook received');

      // Parse payload (might be nested or stringified)
      let payload = req.data.payload;

      // If payload is a string, parse it
      if (typeof payload === 'string') {
        try {
          payload = JSON.parse(payload);
        } catch (e) {
          console.error('Failed to parse payload string:', e);
        }
      }

      // Normalize payload structure
      const normalized = normalizePayload(payload || req.data);

      // Validate payload
      if (!validatePayload(normalized)) {
        console.error('Invalid payload structure');
        return { received: true }; // Return success to prevent retries
      }

      const {
        notificationObjectId,
        notificationTargetStatus,
        documentResult
      } = normalized;

      console.log(`DocAI Webhook: Document ${notificationObjectId}, Status: ${notificationTargetStatus}`);

      // Only process confirmed extractions (user reviewed in DocAI UI)
      // For testing/development, you can remove this check to process all extractions
      if (notificationTargetStatus !== 'confirmed') {
        console.log('Skipping - not confirmed yet. Set to process all statuses in development if needed.');
        // For development, you might want to process 'DONE' status as well
        // Uncomment the following to process any completed extraction:
        // if (notificationTargetStatus !== 'DONE' && notificationTargetStatus !== 'confirmed') {
        //   return { received: true };
        // }
      }

      if (!documentResult) {
        console.log('No DocumentResult in payload');
        return { received: true };
      }

      // Assess quality
      const allEntities = documentResult.documentVersions
        ? documentResult.documentVersions.flatMap(v => v.entities || [])
        : [];

      const quality = assessQuality(allEntities);
      console.log('Extraction quality:', quality);

      // Parse the extraction results
      const invoice = parseDocumentResult(documentResult);

      if (!invoice) {
        console.error('Failed to parse document result');
        return { received: true };
      }

      console.log('Parsed invoice:', JSON.stringify(invoice, null, 2));

      // Find the document by docaiDocumentId
      const { Documents } = cds.entities('com.sap.docai');
      const doc = await SELECT.one.from(Documents)
        .where({ docaiDocumentId: notificationObjectId });

      if (!doc) {
        console.log(`No document found with docaiDocumentId: ${notificationObjectId}`);
        return { received: true };
      }

      console.log(`Found document: ${doc.ID}`);

      // Get invoice service to store results
      const invoiceService = await cds.connect.to('InvoiceProcessingService');

      // Store extraction results
      await invoiceService.storeExtractionResults(doc.ID, invoice);

      // Update document status
      await UPDATE(Documents, doc.ID).set({
        status: 'extracted',
        extractionStatus: notificationTargetStatus
      });

      // Trigger validation automatically
      try {
        await invoiceService.send({
          event: 'validateDocument',
          data: { documentId: doc.ID }
        });
        console.log('Validation triggered');
      } catch (error) {
        console.error('Validation failed:', error);
      }

      console.log('Extraction results stored and validated');
      return { received: true };

    } catch (error) {
      console.error('Webhook processing error:', error);
      // Return success anyway to prevent DocAI retries
      return { received: true };
    }
  });
});
