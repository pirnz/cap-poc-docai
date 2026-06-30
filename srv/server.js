const cds = require('@sap/cds');
const path = require('path');

cds.on('bootstrap', (app) => {
  // Increase body size limit for DocAI payloads
  const bodyParser = require('body-parser');
  app.use(bodyParser.json({ limit: '10mb' }));
  app.use(bodyParser.urlencoded({ extended: true, limit: '10mb' }));

  // Serve static UI5 applications
  const express = require('express');

  // Serve batches app
  app.use('/batches/webapp', express.static(path.join(__dirname, '../app/batches/webapp')));

  // Serve documents app
  app.use('/documents/webapp', express.static(path.join(__dirname, '../app/documents/webapp')));

  // Serve simple HTML UIs
  app.use(express.static(path.join(__dirname, '../app')));

  // Serve common resources if needed
  app.use('/resources', express.static(path.join(__dirname, '../app/resources')));

  console.log('Server bootstrap complete - body parser and static file serving configured');
});

module.exports = cds.server;
