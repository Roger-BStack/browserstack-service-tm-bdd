const BrowserStackService = require('./services/BrowserStackService');
const path = require('path');

(async () => {
  const service = new BrowserStackService();
  const featureDirectory = path.join(__dirname, '../features'); // Adjust the path to your feature files directory
  console.log('Feature files processing...');

  try {
    await service.traverseDirectory(featureDirectory);
    console.log('Feature files processed successfully.');
  } catch (error) {
    console.error(`Error processing feature files: ${error.message}`); // Log error message
    console.error(error.stack); // Log full stack trace
  }
})();