# browserstack-service-tm-bdd

This project parses Gherkin BDD feature files and creates test cases in BrowserStack Test Management using its REST API. The `BrowserStackService` class handles folder creation, test case management, and API communication with BrowserStack.

## Features
- Recursively traverse directories to find `.feature` files.
- Parse `.feature` files using `@cucumber/gherkin`.
- Upload scenarios as "Test Case with Steps" or "BDD Test Case" to BrowserStack Test Management.

## Project Structure
```
browserstack-service-tm-bdd/
├── features/
│   └── Friday.feature
│   └── SocialNetworkLogin.feature
├── src/
│   ├── services/
│   │   └── BrowserStackService.js
│   └── index.js
├── package.json
├── .gitignore
└── README.md
```

## Environment Variables

The following environment variables are required to configure the application:

### Authentication
- **`BROWSERSTACK_USERNAME`**: Your BrowserStack username.
- **`BROWSERSTACK_ACCESS_KEY`**: Your BrowserStack access key.

### Project Configuration
- **`BROWSERSTACK_PROJECT_ID`**: The ID of the BrowserStack project where test cases will be uploaded. _(Example: PR-1)_

### Folder Creation
- **`FOLDER_CREATION_DELAY`**: (Optional) Delay in milliseconds to wait after creating a folder before proceeding. Default is `10000` (10 seconds).

### Test Case Management
- **`EXISTING_TEST_CASE_OPTION`**: (Optional) Determines how to handle existing test cases. Options are:
  - `skip`: Skip uploading if the test case already exists (default).
  - `update`: Update the existing test case.
  - `delete`: Delete and recreate the test case.

### Test Case Template
- **`TEST_CASE_TEMPLATE`**: (Optional) Determines the template for test cases. Options are:
  - `bdd`: Create BDD-style test cases (default). 
  - `steps`: Create test cases with steps.



## Prerequisites
- Node.js (v16 or higher)
- BrowserStack Test Management API credentials

## Installation
1. Clone the repository.
2. Install dependencies:
   ```bash
   npm install
   ```
3. Create a `.env` file in the root directory and configure the required environment variables, OR set them in the shell prior to execution:
   ```env
   BROWSERSTACK_USERNAME=your_username
   BROWSERSTACK_ACCESS_KEY=your_access_key
   BROWSERSTACK_PROJECT_ID=your_project_id
   FOLDER_CREATION_DELAY=10000
   EXISTING_TEST_CASE_OPTION=skip
   TEST_CASE_TEMPLATE=bdd
   ```
   
## Usage
### Running the Application

The application processes all `.feature` files in the `features` directory and uploads scenarios to BrowserStack Test Management.

1. Place your Gherkin feature files in the `features` directory.
2. Run the application:
   ```bash
   npm start
   ```

### Example

The `index.js` file demonstrates how to use the `BrowserStackService` class:

```javascript
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
```