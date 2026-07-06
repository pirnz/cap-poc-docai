/**
 * Express Middleware Configuration for SAP Document AI Callbacks
 *
 * Configures custom middleware to handle callbacks from SAP Document Information
 * Extraction (DocAI) service with CSRF protection and large payload support.
 */

const cds = require('@sap/cds');
const path = require('path');
const csrf = require('csurf');
const bodyParser = require('body-parser');
const express = require('express');
const cookieParser = require('cookie-parser');

/**
 * CSRF PROTECTION CONFIGURATION
 *
 * Protects against cross-site request forgery attacks by requiring a valid token
 * for POST requests. The token is stored in a cookie and must be sent in the
 * X-CSRF-Token header.
 */
const csrfProtection = csrf({ cookie: true });

/**
 * BODY PARSER CONFIGURATION
 *
 * Payload size limit set to 50MB to accommodate DocAI extraction results.
 * UTF-8 encoding explicitly set to handle non-Latin scripts correctly.
 */
const parseForm = express.urlencoded({ extended: false, limit: '50mb' });
const parseJson = bodyParser.json({ limit: '50mb', charset: 'utf-8' });

cds.on('bootstrap', (app) => {
  // Enable cookie parser for CSRF tokens
  app.use(cookieParser());

  // Apply large payload JSON parser globally for all routes
  // This supports file uploads via submitToDocAI action
  app.use(parseJson);

  /**
   * HEAD ENDPOINT: CSRF Token Request
   *
   * Provides CSRF tokens to clients before they can POST data.
   * DocAI service will call this before sending callback.
   */
  app.head('/odata/v4/callback/callback', csrfProtection, (req, res) => {
    res.set({
      'X-CSRF-Token': req.csrfToken(),
      'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate'
    }).send();
  });

  /**
   * POST ENDPOINT: DocAI Callback Handler
   *
   * Receives extraction results from SAP Document Information Extraction service.
   *
   * Middleware chain:
   * 1. parseForm - Parses URL-encoded data (fallback format)
   * 2. csrfProtection - Validates CSRF token from HEAD request
   * 3. next() - Forwards to CDS service handler (callback-service.js)
   *
   * Note: parseJson is already applied globally above
   */
  app.post('/odata/v4/callback/callback', parseForm, csrfProtection, (req, res, next) => {
    // Payload is now parsed and available in req.body
    // Forward to CDS service handler for processing
    next();
  });

  /**
   * ERROR HANDLER: CSRF Token Validation Failures
   *
   * Catches CSRF validation errors and returns a 403 Forbidden response.
   */
  app.use((err, req, res, next) => {
    if (err.code !== 'EBADCSRFTOKEN') return next(err);
    res.status(403).set('X-CSRF-Token', 'required').send();
  });

  // Serve static UI5 applications
  // Serve batches app
  app.use('/batches/webapp', express.static(path.join(__dirname, '../app/batches/webapp')));

  // Serve documents app
  app.use('/documents/webapp', express.static(path.join(__dirname, '../app/documents/webapp')));

  // Serve simple HTML UIs
  app.use(express.static(path.join(__dirname, '../app')));

  // Serve common resources if needed
  app.use('/resources', express.static(path.join(__dirname, '../app/resources')));

  console.log('Server bootstrap complete - CSRF protection, body parser, and static file serving configured');
});

module.exports = cds.server;
