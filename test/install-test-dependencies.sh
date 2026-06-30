#!/bin/bash
# Install and run the DocAI Workbench test suite

echo "📦 Installing Playwright..."
npm install --save-dev playwright

echo "🔧 Installing Playwright browsers..."
npx playwright install chromium

echo "✅ Installation complete!"
echo ""
echo "Available commands:"
echo "  npm run test:workbench          - Run tests with browser visible"
echo "  npm run test:workbench:headless - Run tests in headless mode"
echo ""
echo "Direct commands:"
echo "  node test/test-workbench.js                    - Interactive mode"
echo "  HEADLESS=true node test/test-workbench.js      - Headless mode"
echo "  SLOW_MO=100 node test/test-workbench.js        - Slow motion debug"
echo ""
echo "📖 See test/TEST-WORKBENCH.md for full documentation"
