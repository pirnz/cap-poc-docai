#!/usr/bin/env node
/**
 * Custom Test Runner for DocAI Workbench
 *
 * This file demonstrates how to run specific tests or customize test behavior.
 * You can modify this to create custom test suites for different scenarios.
 */

const { chromium } = require('playwright');
const path = require('path');

// Import the main test suite
const { config } = require('./test-workbench.js');

// Example: Quick smoke test - just verify app loads and basic navigation works
async function quickSmokeTest() {
  console.log('🔥 Running Quick Smoke Test...\n');

  const browser = await chromium.launch({
    headless: config.headless,
    slowMo: config.slowMo
  });

  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 }
  });

  const page = await context.newPage();

  try {
    // Navigate to workbench
    await page.goto(`${config.serviceUrl}${config.workbenchPath}`, {
      waitUntil: 'networkidle',
      timeout: config.timeout
    });

    // Wait for UI5
    await page.waitForFunction(() => {
      return window.sap && window.sap.ui && window.sap.ui.getCore;
    }, { timeout: 30000 });

    console.log('✅ App loaded successfully');

    // Verify list view is visible
    const view = await page.evaluate(() => {
      const model = sap.ui.getCore().getModel('documents');
      return model ? model.getProperty('/view') : null;
    });

    if (view !== 'list') {
      throw new Error(`Expected list view, got ${view}`);
    }

    console.log('✅ Initial view is correct (list)');

    // Verify key UI elements exist
    const elementsExist = await page.evaluate(() => {
      const table = document.querySelector('[id*="documentsTable"]');
      const uploadPanel = document.querySelector('[id*="uploadPanel"]');
      return { table: !!table, uploadPanel: !!uploadPanel };
    });

    if (!elementsExist.table || !elementsExist.uploadPanel) {
      throw new Error('Key UI elements not found');
    }

    console.log('✅ Key UI elements present');
    console.log('\n✅ Smoke test passed!\n');

  } catch (error) {
    console.error('❌ Smoke test failed:', error.message);
    await page.screenshot({
      path: path.join(__dirname, 'smoke-test-failure.png'),
      fullPage: true
    });
    throw error;
  } finally {
    await browser.close();
  }
}

// Example: Test only upload and view switching (no full workflow)
async function uploadAndNavigationTest() {
  console.log('📤 Running Upload and Navigation Test...\n');

  const browser = await chromium.launch({
    headless: config.headless,
    slowMo: config.slowMo
  });

  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 }
  });

  const page = await context.newPage();

  try {
    // Navigate
    await page.goto(`${config.serviceUrl}${config.workbenchPath}`, {
      waitUntil: 'networkidle',
      timeout: config.timeout
    });

    await page.waitForFunction(() => {
      return window.sap && window.sap.ui && window.sap.ui.getCore;
    }, { timeout: 30000 });

    console.log('✅ App loaded');

    // Set up schema and client
    await page.evaluate(() => {
      const schemaSelect = sap.ui.getCore().byId('__xmlview0--schemaVersionSelect');
      const items = schemaSelect?.getItems();
      if (items && items.length > 0) {
        schemaSelect.setSelectedItem(items[0]);
      }

      const clientCombo = sap.ui.getCore().byId('__xmlview0--clientComboBox');
      clientCombo?.setValue('default');
    });

    console.log('✅ Configuration set');

    // Upload a file
    const testFile = path.join(__dirname, 'files/sample-documents/Invoice/chinese_blogger.pdf');
    const fileInput = await page.locator('input[type="file"]').first();
    await fileInput.setInputFiles(testFile);
    await page.waitForTimeout(1000);

    await page.evaluate(() => {
      const uploadButton = sap.ui.getCore().byId('__xmlview0--uploadButton');
      uploadButton?.firePress();
    });

    await page.waitForTimeout(2000);

    const view = await page.evaluate(() => {
      const model = sap.ui.getCore().getModel('documents');
      return model?.getProperty('/view');
    });

    if (view !== 'detail') {
      throw new Error(`Expected detail view after upload, got ${view}`);
    }

    console.log('✅ Switched to detail view after upload');

    // Go back to list
    await page.evaluate(() => {
      const backButton = sap.ui.getCore().byId('__xmlview0--backButton');
      backButton?.firePress();
    });

    await page.waitForTimeout(1000);

    const viewAfterBack = await page.evaluate(() => {
      const model = sap.ui.getCore().getModel('documents');
      return model?.getProperty('/view');
    });

    if (viewAfterBack !== 'list') {
      throw new Error(`Expected list view after back, got ${viewAfterBack}`);
    }

    console.log('✅ Returned to list view');
    console.log('\n✅ Upload and navigation test passed!\n');

  } catch (error) {
    console.error('❌ Test failed:', error.message);
    await page.screenshot({
      path: path.join(__dirname, 'upload-nav-test-failure.png'),
      fullPage: true
    });
    throw error;
  } finally {
    await browser.close();
  }
}

// Example: Run a specific test scenario
async function runCustomTest(testName) {
  switch (testName) {
    case 'smoke':
      await quickSmokeTest();
      break;
    case 'upload':
      await uploadAndNavigationTest();
      break;
    default:
      console.error(`Unknown test: ${testName}`);
      console.log('Available tests: smoke, upload');
      process.exit(1);
  }
}

// Main execution
async function main() {
  const testArg = process.argv[2];

  if (!testArg) {
    console.log('Usage: node test/custom-test-runner.js <test-name>');
    console.log('');
    console.log('Available tests:');
    console.log('  smoke   - Quick smoke test (app loads and basic UI)');
    console.log('  upload  - Upload and navigation test');
    console.log('');
    console.log('Examples:');
    console.log('  node test/custom-test-runner.js smoke');
    console.log('  HEADLESS=true node test/custom-test-runner.js upload');
    console.log('  SLOW_MO=200 node test/custom-test-runner.js smoke');
    process.exit(0);
  }

  try {
    await runCustomTest(testArg);
    process.exit(0);
  } catch (error) {
    console.error('Test failed:', error.message);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = { quickSmokeTest, uploadAndNavigationTest };
