/**
 * Audit Service Implementation
 *
 * Implements audit and performance metrics functionality for DocAI extractions.
 * Queries DocAI API for document data and generates analytics.
 */

const cds = require('@sap/cds');
const { assessQuality } = require('./utils/docai-parser');

module.exports = cds.service.impl(async function() {
  const { AuditMetrics, ClientSchemaUsage } = this.entities;

  /**
   * Helper: Sleep for retry backoff
   */
  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Helper: Execute with exponential backoff retry
   */
  async function executeWithRetry(fn, maxRetries = 3, baseDelay = 1000) {
    let lastError;
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        return await fn();
      } catch (error) {
        lastError = error;
        if (attempt < maxRetries - 1) {
          const delay = baseDelay * Math.pow(2, attempt);
          console.log(`[RETRY] Attempt ${attempt + 1} failed, retrying in ${delay}ms...`);
          await sleep(delay);
        }
      }
    }
    throw lastError;
  }

  /**
   * Helper: Get destination and auth headers
   */
  async function getDocAIConnection() {
    const { getDestination } = require('@sap-cloud-sdk/connectivity');
    const destinationName = 'docai-destination';

    const destConfig = await getDestination({ destinationName });
    const baseUrl = destConfig.url.replace(/\/$/, '');

    const authHeaders = destConfig.authTokens && destConfig.authTokens.length > 0
      ? { 'Authorization': `Bearer ${destConfig.authTokens[0].value}` }
      : {};

    return { baseUrl, authHeaders };
  }

  /**
   * Helper: Calculate confidence metrics from entities
   */
  function calculateConfidenceMetrics(entities) {
    const fields = entities.filter(e => e.type === 'Field' && e.confidence !== undefined);

    if (fields.length === 0) {
      return {
        avgFieldConfidence: 0,
        totalFields: 0,
        confirmedFields: 0
      };
    }

    const totalConfidence = fields.reduce((sum, field) => sum + (field.confidence || 0), 0);
    const avgConfidence = totalConfidence / fields.length;
    const confirmedFields = fields.filter(f => f.signedOff === true).length;

    return {
      avgFieldConfidence: parseFloat(avgConfidence.toFixed(4)),
      totalFields: fields.length,
      confirmedFields: confirmedFields
    };
  }

  /**
   * Helper: Fetch schema metadata and cache it
   */
  async function getSchemaMetadata(schemaVersionId, baseUrl, authHeaders, schemaCache) {
    if (schemaCache.has(schemaVersionId)) {
      return schemaCache.get(schemaVersionId);
    }

    const axios = require('axios');
    const schemaUrl = `${baseUrl}/SchemaService/SchemaVersions(${schemaVersionId})?$expand=schema`;

    try {
      const response = await executeWithRetry(async () => {
        return await axios.get(schemaUrl, { headers: authHeaders });
      });

      const metadata = {
        schemaName: response.data.schema?.name || 'Unknown',
        schemaVersion: response.data.version || 0,
        clientId: response.data.schema?.clientId || 'default'
      };

      schemaCache.set(schemaVersionId, metadata);
      return metadata;
    } catch (error) {
      console.error(`[ERROR] Failed to fetch schema metadata for ${schemaVersionId}:`, error.message);
      return {
        schemaName: 'Unknown',
        schemaVersion: 0,
        clientId: 'default'
      };
    }
  }

  /**
   * Refresh Audit Data Action
   * Main data collection function - queries DocAI and populates metrics
   */
  this.on('refreshAuditData', async (req) => {
    const { startDate, endDate } = req.data;
    const startTime = Date.now();
    const errors = [];
    let recordsProcessed = 0;

    console.log(`[INFO] refreshAuditData - Start: ${startDate}, End: ${endDate}`);

    try {
      const axios = require('axios');
      const { baseUrl, authHeaders } = await getDocAIConnection();

      // Build OData filter for date range
      const startDateStr = new Date(startDate).toISOString();
      const endDateStr = endDate ? new Date(endDate).toISOString() : new Date().toISOString();

      console.log(`[INFO] Querying documents from ${startDateStr} to ${endDateStr}`);

      // Query documents with pagination
      const pageSize = 1000;
      let skip = 0;
      let hasMore = true;
      const snapshotTimestamp = new Date().toISOString();

      // Schema metadata cache
      const schemaCache = new Map();

      // Document tracking to avoid duplicates within this refresh
      const processedDocuments = new Set();

      // Aggregation map for ClientSchemaUsage
      const usageMap = new Map();

      while (hasMore) {
        console.log(`[INFO] Fetching documents - skip: ${skip}, top: ${pageSize}`);

        // Build URL with filter and expand
        const documentsUrl = `${baseUrl}/DocumentService/Documents?` +
          `$filter=createdAt ge ${startDateStr} and createdAt le ${endDateStr}` +
          `&$expand=versions($expand=entities)` +
          `&$skip=${skip}&$top=${pageSize}` +
          `&$orderby=createdAt asc`;

        let documentsResponse;
        try {
          documentsResponse = await executeWithRetry(async () => {
            return await axios.get(documentsUrl, {
              headers: authHeaders,
              timeout: 60000 // 60 second timeout
            });
          });
        } catch (error) {
          const errorMsg = `Failed to fetch documents at skip=${skip}: ${error.message}`;
          console.error(`[ERROR] ${errorMsg}`);
          errors.push(errorMsg);
          break;
        }

        const documents = documentsResponse.data.value || [];
        console.log(`[INFO] Retrieved ${documents.length} documents in this batch`);

        if (documents.length === 0) {
          hasMore = false;
          break;
        }

        // Process each document
        for (const doc of documents) {
          try {
            // Skip if already processed in this refresh
            if (processedDocuments.has(doc.ID)) {
              console.log(`[INFO] Skipping duplicate document ${doc.ID} in same refresh`);
              continue;
            }

            const versions = doc.versions || [];

            if (versions.length === 0) {
              console.log(`[WARN] Document ${doc.ID} has no versions, skipping`);
              continue;
            }

            // Get latest version
            const latestVersion = versions.reduce((prev, current) =>
              (current.version > prev.version) ? current : prev
            );

            const entities = latestVersion.entities || [];

            // Get schema metadata
            const schemaVersionId = doc.schemaVersion_ID;
            let schemaMetadata = { schemaName: 'Unknown', schemaVersion: 0, clientId: 'default' };

            if (schemaVersionId) {
              schemaMetadata = await getSchemaMetadata(schemaVersionId, baseUrl, authHeaders, schemaCache);
            }

            // Calculate metrics
            const confidenceMetrics = calculateConfidenceMetrics(entities);

            // Calculate extraction duration
            let extractionDuration = null;
            if (doc.createdAt && doc.finishedAt) {
              const created = new Date(doc.createdAt);
              const finished = new Date(doc.finishedAt);
              extractionDuration = finished - created;
            }

            // Check if document already exists
            const existing = await SELECT.one.from(AuditMetrics).where({
              docaiDocumentId: doc.ID
            });

            const metricData = {
              snapshotAt: snapshotTimestamp,
              docaiDocumentId: doc.ID,
              clientId: schemaMetadata.clientId,
              schemaVersionId: schemaVersionId || null,
              schemaName: schemaMetadata.schemaName,
              schemaVersion: schemaMetadata.schemaVersion,
              documentCreatedAt: doc.createdAt,
              documentFinishedAt: doc.finishedAt || null,
              extractionDuration: extractionDuration,
              status: doc.status || 'unknown',
              documentConfidence: doc.confidenceScore || 0,
              avgFieldConfidence: confidenceMetrics.avgFieldConfidence,
              totalFields: confidenceMetrics.totalFields,
              confirmedFields: confidenceMetrics.confirmedFields,
              rawDocumentData: JSON.stringify({
                documentId: doc.ID,
                status: doc.status,
                createdAt: doc.createdAt,
                finishedAt: doc.finishedAt,
                schemaVersionId: schemaVersionId,
                clientId: schemaMetadata.clientId,
                metrics: confidenceMetrics
              })
            };

            if (existing) {
              // Update existing record
              await UPDATE(AuditMetrics, existing.ID).set(metricData);
            } else {
              // Insert new record
              await INSERT.into(AuditMetrics).entries(metricData);
            }

            // Mark as processed to avoid duplicates in this refresh
            processedDocuments.add(doc.ID);

            recordsProcessed++;

            // Aggregate for ClientSchemaUsage
            const usageKey = `${schemaMetadata.clientId}|${schemaVersionId}`;
            if (!usageMap.has(usageKey)) {
              usageMap.set(usageKey, {
                clientId: schemaMetadata.clientId,
                schemaVersionId: schemaVersionId,
                schemaName: schemaMetadata.schemaName,
                schemaVersion: schemaMetadata.schemaVersion,
                count: 0,
                totalConfidence: 0,
                totalDuration: 0,
                validDurations: 0,
                lastExtractionAt: doc.finishedAt || doc.createdAt
              });
            }

            const usage = usageMap.get(usageKey);
            usage.count++;
            usage.totalConfidence += confidenceMetrics.avgFieldConfidence;

            if (extractionDuration) {
              usage.totalDuration += extractionDuration;
              usage.validDurations++;
            }

            if (doc.finishedAt || doc.createdAt) {
              const docTime = new Date(doc.finishedAt || doc.createdAt);
              const lastTime = new Date(usage.lastExtractionAt);
              if (docTime > lastTime) {
                usage.lastExtractionAt = doc.finishedAt || doc.createdAt;
              }
            }

          } catch (docError) {
            const errorMsg = `Error processing document ${doc.ID}: ${docError.message}`;
            console.error(`[ERROR] ${errorMsg}`);
            errors.push(errorMsg);
          }
        }

        // Check if more pages available
        if (documents.length < pageSize) {
          hasMore = false;
        } else {
          skip += pageSize;
        }

        // Add small delay between pages to avoid rate limiting
        await sleep(100);
      }

      // Update ClientSchemaUsage summary - recalculate from AuditMetrics
      console.log(`[INFO] Recalculating ClientSchemaUsage summaries from AuditMetrics`);

      // Get all unique client/schema combinations from AuditMetrics
      const allMetrics = await SELECT.from(AuditMetrics);
      const usageSummaryMap = new Map();

      for (const metric of allMetrics) {
        const key = `${metric.clientId}|${metric.schemaVersionId}`;

        if (!usageSummaryMap.has(key)) {
          usageSummaryMap.set(key, {
            clientId: metric.clientId,
            schemaVersionId: metric.schemaVersionId,
            schemaName: metric.schemaName,
            schemaVersion: metric.schemaVersion,
            count: 0,
            totalConfidence: 0,
            totalDuration: 0,
            validDurations: 0,
            lastExtractionAt: metric.documentFinishedAt || metric.documentCreatedAt
          });
        }

        const summary = usageSummaryMap.get(key);
        summary.count++;
        summary.totalConfidence += metric.avgFieldConfidence || 0;

        if (metric.extractionDuration) {
          summary.totalDuration += metric.extractionDuration;
          summary.validDurations++;
        }

        // Track latest extraction
        const metricTime = new Date(metric.documentFinishedAt || metric.documentCreatedAt);
        const summaryTime = new Date(summary.lastExtractionAt);
        if (metricTime > summaryTime) {
          summary.lastExtractionAt = metric.documentFinishedAt || metric.documentCreatedAt;
        }
      }

      // Update or insert ClientSchemaUsage records
      for (const [key, summary] of usageSummaryMap.entries()) {
        const avgConfidence = summary.count > 0
          ? parseFloat((summary.totalConfidence / summary.count).toFixed(4))
          : 0;

        const avgDuration = summary.validDurations > 0
          ? Math.round(summary.totalDuration / summary.validDurations)
          : null;

        // Check if entry exists
        const existing = await SELECT.one.from(ClientSchemaUsage).where({
          clientId: summary.clientId,
          schemaVersionId: summary.schemaVersionId
        });

        const usageData = {
          schemaName: summary.schemaName,
          schemaVersion: summary.schemaVersion,
          totalExtractions: summary.count,
          lastExtractionAt: summary.lastExtractionAt,
          avgConfidence: avgConfidence,
          avgDuration: avgDuration,
          snapshotAt: snapshotTimestamp
        };

        if (existing) {
          // Update existing with recalculated values
          await UPDATE(ClientSchemaUsage, existing.ID).set(usageData);
        } else {
          // Insert new
          await INSERT.into(ClientSchemaUsage).entries({
            clientId: summary.clientId,
            schemaVersionId: summary.schemaVersionId,
            ...usageData
          });
        }
      }

      console.log(`[INFO] Updated ${usageSummaryMap.size} ClientSchemaUsage records`);

      const executionTime = Date.now() - startTime;
      console.log(`[INFO] refreshAuditData complete - ${recordsProcessed} records in ${executionTime}ms`);

      return {
        status: errors.length > 0 ? 'completed_with_errors' : 'success',
        recordsProcessed: recordsProcessed,
        snapshotTimestamp: snapshotTimestamp,
        executionTime: executionTime,
        errors: errors
      };

    } catch (error) {
      console.error('[ERROR] refreshAuditData failed:', error);
      const executionTime = Date.now() - startTime;

      // Check if it's a destination/connectivity error
      const isConnectivityError = error.message && (
        error.message.includes('destination') ||
        error.message.includes('service binding')
      );

      return {
        status: 'failed',
        recordsProcessed: recordsProcessed,
        snapshotTimestamp: new Date().toISOString(),
        executionTime: executionTime,
        errors: isConnectivityError
          ? ['DocAI destination not configured. Configure destination service binding or default-env.json for local development.']
          : [...errors, `Fatal error: ${error.message}`]
      };
    }
  });

  /**
   * Get Client Summary Function
   * Returns aggregated metrics grouped by client
   */
  this.on('getClientSummary', async (req) => {
    console.log('[INFO] getClientSummary');

    try {
      // Query ClientSchemaUsage and group by clientId
      const usageData = await SELECT.from(ClientSchemaUsage);

      // Group by clientId
      const clientMap = new Map();

      for (const usage of usageData) {
        if (!clientMap.has(usage.clientId)) {
          clientMap.set(usage.clientId, {
            clientId: usage.clientId,
            totalSchemas: 0,
            totalExtractions: 0,
            totalConfidence: 0,
            validConfidence: 0,
            totalDuration: 0,
            validDuration: 0,
            lastExtractionAt: usage.lastExtractionAt
          });
        }

        const client = clientMap.get(usage.clientId);
        client.totalSchemas++;
        client.totalExtractions += usage.totalExtractions || 0;

        if (usage.avgConfidence) {
          client.totalConfidence += usage.avgConfidence;
          client.validConfidence++;
        }

        if (usage.avgDuration) {
          client.totalDuration += usage.avgDuration;
          client.validDuration++;
        }

        if (usage.lastExtractionAt) {
          const usageTime = new Date(usage.lastExtractionAt);
          const clientTime = new Date(client.lastExtractionAt);
          if (usageTime > clientTime) {
            client.lastExtractionAt = usage.lastExtractionAt;
          }
        }
      }

      // Convert to array with calculated averages
      const summary = Array.from(clientMap.values()).map(client => ({
        clientId: client.clientId,
        totalSchemas: client.totalSchemas,
        totalExtractions: client.totalExtractions,
        avgConfidence: client.validConfidence > 0
          ? parseFloat((client.totalConfidence / client.validConfidence).toFixed(4))
          : 0,
        avgDuration: client.validDuration > 0
          ? Math.round(client.totalDuration / client.validDuration)
          : 0,
        lastExtractionAt: client.lastExtractionAt
      }));

      console.log(`[INFO] getClientSummary - Found ${summary.length} clients`);
      return summary;

    } catch (error) {
      console.error('[ERROR] getClientSummary failed:', error);
      req.error(500, `Failed to get client summary: ${error.message}`);
    }
  });

  /**
   * Get Usage Trend Function
   * Returns time-series data for specific client/schema
   */
  this.on('getUsageTrend', async (req) => {
    const { clientId, schemaVersionId, timeRange = 30, bucketSize = 'day' } = req.data;

    console.log(`[INFO] getUsageTrend - clientId: ${clientId}, schemaVersionId: ${schemaVersionId}, timeRange: ${timeRange}, bucketSize: ${bucketSize}`);

    try {
      // Calculate start date based on timeRange
      const endDate = new Date();
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - timeRange);

      // Build filter object
      const filter = {};

      if (clientId) {
        filter.clientId = clientId;
      }

      if (schemaVersionId) {
        filter.schemaVersionId = schemaVersionId;
      }

      // Query AuditMetrics with date filter
      let query = SELECT.from(AuditMetrics)
        .where('documentCreatedAt >=', startDate.toISOString())
        .and('documentCreatedAt <=', endDate.toISOString());

      // Apply additional filters
      if (filter.clientId) {
        query = query.and('clientId =', filter.clientId);
      }

      if (filter.schemaVersionId) {
        query = query.and('schemaVersionId =', filter.schemaVersionId);
      }

      query = query.orderBy('documentCreatedAt');

      const metrics = await query;

      // Bucket data by time
      const buckets = new Map();

      for (const metric of metrics) {
        if (!metric.documentCreatedAt) continue;

        const timestamp = new Date(metric.documentCreatedAt);
        let bucketKey;

        // Determine bucket based on bucketSize
        if (bucketSize === 'hour') {
          timestamp.setMinutes(0, 0, 0);
          bucketKey = timestamp.toISOString();
        } else if (bucketSize === 'week') {
          const weekStart = new Date(timestamp);
          weekStart.setDate(timestamp.getDate() - timestamp.getDay());
          weekStart.setHours(0, 0, 0, 0);
          bucketKey = weekStart.toISOString();
        } else { // day (default)
          timestamp.setHours(0, 0, 0, 0);
          bucketKey = timestamp.toISOString();
        }

        if (!buckets.has(bucketKey)) {
          buckets.set(bucketKey, {
            timestamp: bucketKey,
            count: 0,
            totalConfidence: 0,
            totalDuration: 0,
            validDurations: 0
          });
        }

        const bucket = buckets.get(bucketKey);
        bucket.count++;
        bucket.totalConfidence += metric.avgFieldConfidence || 0;

        if (metric.extractionDuration) {
          bucket.totalDuration += metric.extractionDuration;
          bucket.validDurations++;
        }
      }

      // Convert to array with calculated averages
      const trend = Array.from(buckets.values()).map(bucket => ({
        timestamp: bucket.timestamp,
        extractionCount: bucket.count,
        avgConfidence: bucket.count > 0
          ? parseFloat((bucket.totalConfidence / bucket.count).toFixed(4))
          : 0,
        avgDuration: bucket.validDurations > 0
          ? Math.round(bucket.totalDuration / bucket.validDurations)
          : 0
      })).sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

      console.log(`[INFO] getUsageTrend - Generated ${trend.length} data points`);
      return trend;

    } catch (error) {
      console.error('[ERROR] getUsageTrend failed:', error);
      req.error(500, `Failed to get usage trend: ${error.message}`);
    }
  });

  /**
   * Get Schemas by Client Function
   * Returns list of schemas used by a specific client
   */
  this.on('getSchemasByClient', async (req) => {
    const { clientId } = req.data;

    console.log(`[INFO] getSchemasByClient - clientId: ${clientId}`);

    try {
      const schemas = await SELECT.from(ClientSchemaUsage).where({ clientId: clientId });

      const result = schemas.map(schema => ({
        schemaVersionId: schema.schemaVersionId,
        schemaName: schema.schemaName,
        schemaVersion: schema.schemaVersion,
        totalExtractions: schema.totalExtractions || 0,
        avgConfidence: schema.avgConfidence || 0,
        lastExtractionAt: schema.lastExtractionAt
      }));

      console.log(`[INFO] getSchemasByClient - Found ${result.length} schemas for client ${clientId}`);
      return result;

    } catch (error) {
      console.error('[ERROR] getSchemasByClient failed:', error);
      req.error(500, `Failed to get schemas by client: ${error.message}`);
    }
  });
});
