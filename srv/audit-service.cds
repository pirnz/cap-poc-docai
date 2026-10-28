using { com.sap.docai as db } from '../db/schema';

/**
 * Audit Service for SAP Document Information Extraction
 *
 * Provides audit and performance metrics for DocAI extractions:
 * - Document-level extraction metrics
 * - Client and schema usage summaries
 * - Time-series trending data
 * - Quality and performance analytics
 */
@(requires: 'any')
service AuditService @(path: '/audit') {

  // Entities
  entity AuditMetrics as projection on db.AuditMetrics;
  entity ClientSchemaUsage as projection on db.ClientSchemaUsage;

  // Filter Value Lists
  entity MailProcessingStatus as projection on db.MailProcessingStatus;
  entity ResponsibilityRegion as projection on db.ResponsibilityRegion;
  entity PartnerProfile as projection on db.PartnerProfile;
  entity AttachmentProcessingStatus as projection on db.AttachmentProcessingStatus;
  entity AttachmentExtractionStatus as projection on db.AttachmentExtractionStatus;
  entity DocumentType as projection on db.DocumentType;
  entity BasicRoutingStatus as projection on db.BasicRoutingStatus;

  /**
   * Refresh Audit Data
   * Queries DocAI API for documents within date range and populates audit metrics
   *
   * @param startDate - Start date for document query (ISO format)
   * @param endDate - End date for document query (ISO format)
   * @returns Execution summary with record counts and timing
   */
  action refreshAuditData(
    startDate: DateTime,
    endDate: DateTime
  ) returns {
    status: String;
    recordsProcessed: Integer;
    snapshotTimestamp: DateTime;
    executionTime: Integer;
    errors: array of String;
  };

  /**
   * Get Client Summary
   * Returns aggregated summary of extractions grouped by client
   *
   * @returns Array of client summaries with total extractions and avg metrics
   */
  function getClientSummary() returns array of {
    clientId: String;
    totalSchemas: Integer;
    totalExtractions: Integer;
    avgConfidence: Decimal(5,4);
    avgDuration: Integer;
    lastExtractionAt: DateTime;
  };

  /**
   * Get Usage Trend
   * Returns time-series data for a specific client and schema
   *
   * @param clientId - Client ID to filter by
   * @param schemaVersionId - Schema version ID to filter by (optional)
   * @param timeRange - Time range in days (default: 30)
   * @param bucketSize - Time bucket size: 'hour', 'day', 'week' (default: 'day')
   * @returns Time-series array with aggregated metrics per bucket
   */
  function getUsageTrend(
    clientId: String,
    schemaVersionId: String,
    timeRange: Integer,
    bucketSize: String
  ) returns array of {
    timestamp: DateTime;
    extractionCount: Integer;
    avgConfidence: Decimal(5,4);
    avgDuration: Integer;
  };

  /**
   * Get Schemas by Client
   * Returns list of schemas used by a specific client
   *
   * @param clientId - Client ID to filter by
   * @returns Array of schema summaries for the client
   */
  function getSchemasByClient(
    clientId: String
  ) returns array of {
    schemaVersionId: String;
    schemaName: String;
    schemaVersion: Integer;
    totalExtractions: Integer;
    avgConfidence: Decimal(5,4);
    lastExtractionAt: DateTime;
  };
}
