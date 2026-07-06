using { com.sap.docai as db } from '../db/schema';

/**
 * Callback Service for SAP Document Information Extraction
 *
 * Receives callbacks from DocAI service when document processing completes.
 * Handles any schema type - extracts and stores results dynamically.
 */
@requires: 'system-user'
@cds.server.body_parser.limit: '50mb'
service CallbackService @(path: '/odata/v4/callback') {

  /**
   * DocAI callback endpoint
   * Called by DocAI service with extraction results
   */
  @open
  action callback(payload: LargeString) returns String;

}
