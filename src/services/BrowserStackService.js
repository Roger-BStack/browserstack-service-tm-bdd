const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { GherkinStreams } = require('@cucumber/gherkin-streams');
require('dotenv').config();

class BrowserStackService {
    constructor() {
        this.apiBaseUrl = 'https://test-management.browserstack.com/api/v2';
        this.auth = {
            username: process.env.BROWSERSTACK_USERNAME,
            password: process.env.BROWSERSTACK_ACCESS_KEY,
        };
        this.projectId = process.env.BROWSERSTACK_PROJECT_ID;
        this.folderCreationDelay = parseInt(process.env.FOLDER_CREATION_DELAY || '10000', 10); // Default to 10 seconds
    }

    async delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    async traverseDirectory(directory) {
        const files = fs.readdirSync(directory);
        for (const file of files) {
            const fullPath = path.join(directory, file);
            const stat = fs.statSync(fullPath);
            console.log(`Processing: ${fullPath} for Project ID: ${this.projectId}`);
            if (stat.isDirectory()) {
                await this.traverseDirectory(fullPath);
            } else if (file.endsWith('.feature')) {
                await this.processFeatureFile(fullPath);
            }
        }
    }

    async processFeatureFile(filePath) {
        const featureContent = fs.readFileSync(filePath, 'utf8');

        const options = {
            includeSource: false,
            includeGherkinDocument: true,
            includePickles: false,
        }
        const stream = GherkinStreams.fromPaths([filePath], options);

        for await (const message of stream) {
            // Process the message (e.g., a GherkinDocument, a Pickle, or a Source message)
            if (message.gherkinDocument) {
                console.log('Parsed Feature Name:', message.gherkinDocument.feature.name);
                await this.processGherkinDocument(message.gherkinDocument, filePath);
            }
        }
    }

    async processGherkinDocument(gherkinDocument, filePath) {
        const feature = gherkinDocument.feature;
        if (feature) {
            console.log(`Feature Name: ${feature.name}`);

            for (const scenario of feature.children) {
                if (scenario.scenario) {
                    console.log(`\n  Scenario Name: ${scenario.scenario.name}`);
                    for (const step of scenario.scenario.steps) {
                        console.log(`    Step: ${step.keyword.trim()} ${step.text}`);
                    }
                    console.log(`\nUploading Scenario: ${scenario.scenario.name}`);
                    await this.uploadPickleScenario(filePath, feature.name, scenario.scenario);
                }
            }
        }
    }

    async uploadPickleScenario(featureFilePath, featureName, scenario) {
        const folderName = path.basename(featureFilePath); // Use full feature file name as folder name
        const scenarioName = scenario.name;
        const background = scenario.steps.filter(step => step.keyword === 'Background').map(step => step.text).join('\n');

        // Determine the test case template based on configuration
        const testCaseTemplate = process.env.TEST_CASE_TEMPLATE || 'bdd'; // Default to 'bdd'

        if (testCaseTemplate === 'steps') {
            console.log(`Uploading as Test Case with Steps: ${scenarioName}`);
            await this.createTestCaseWithSteps(folderName, scenarioName, featureName, background, scenario.steps);
        } else if (testCaseTemplate === 'bdd') {
            console.log(`Uploading as BDD Test Case: ${scenarioName}`);
            await this.createBDDTestCase(folderName, scenarioName, featureName, background, scenario.steps);
        } else {
            console.error(`Invalid TEST_CASE_TEMPLATE value: ${testCaseTemplate}. Must be 'steps' or 'bdd'.`);
            throw new Error(`Invalid TEST_CASE_TEMPLATE value: ${testCaseTemplate}`);
        }
    }

    async getOrCreateFolder(folderName) {
        try {
            let folders = [];
            let nextPage = 1;

            // Fetch all pages of folders using info.next
            while (nextPage) {
                const response = await axios.get(
                    `${this.apiBaseUrl}/projects/${this.projectId}/folders?p=${nextPage}`,
                    { auth: this.auth }
                );

                if (response.data && response.data.folders) {
                    folders = folders.concat(response.data.folders);
                    nextPage = response.data.info?.next || null; // Use info.next to determine the next page
                } else {
                    break;
                }
            }

            // Check if the folder already exists
            const existingFolder = folders.find(folder => folder.name === folderName);
            if (existingFolder) {
                console.log(`Folder '${folderName}' already exists with ID: ${existingFolder.id}`);
                return existingFolder.id;
            }

            // Folder does not exist, create a new one
            const createResponse = await axios.post(
                `${this.apiBaseUrl}/projects/${this.projectId}/folders`,
                { folder: { name: folderName, description: `Folder for feature: ${folderName}` } },
                { auth: this.auth }
            );

            if (createResponse.data && createResponse.data.folder) {
                console.log(`Created new folder '${folderName}' with ID: ${createResponse.data.folder.id}`);
                console.log(`Waiting for ${this.folderCreationDelay} ms, for initial folder creation to be finalized...`);
                await this.delay(this.folderCreationDelay); // Add delay after folder creation
                return createResponse.data.folder.id;
            }

            throw new Error(`Failed to create folder '${folderName}'`);
        } catch (error) {
            console.error(`Error in getOrCreateFolder: ${error.message}`);
            throw error;
        }
    }

    async handleExistingTestCase(existingTestCase, scenarioName, createTestCaseCallback) {
        const userOption = process.env.EXISTING_TEST_CASE_OPTION || 'skip';
        const testCaseTemplate = process.env.TEST_CASE_TEMPLATE || 'bdd';

        if (userOption === 'skip') {
            console.log(`Skipping upload for existing test case: ${scenarioName}`);
            return;
        }

        if (userOption === 'update') {
            const expectedTemplate = testCaseTemplate === 'bdd' ? 'test_case_bdd' : 'test_case_steps';
            if (existingTestCase.template !== expectedTemplate) {
                console.warn(
                    `Template mismatch for test case '${scenarioName}'. ` +
                    `Expected: '${expectedTemplate}', Found: '${existingTestCase.template}'. Skipping update.`
                );
                return;
            }
            console.log(`Updating existing test case: ${scenarioName}`);
            await this.updateTestCase(existingTestCase.identifier, createTestCaseCallback);
            return;
        }

        if (userOption === 'delete') {
            console.log(`Deleting and recreating test case: ${scenarioName}`);
            await this.deleteTestCase(existingTestCase.identifier);
            console.log(`Recreating test case: ${scenarioName}`);
            const folderId = existingTestCase.folder_id; // Assuming folder_id is available in existingTestCase
            const payload = await createTestCaseCallback(folderId);
            const createResponse = await axios.post(
                `${this.apiBaseUrl}/projects/${this.projectId}/folders/${folderId}/test-cases`,
                payload,
                { auth: this.auth }
            );

            const newTestCase = createResponse.data?.data?.test_case;
            if (newTestCase) {
                console.log(`Test case '${scenarioName}' recreated successfully with ID: ${newTestCase.identifier}`);
            } else {
                throw new Error(`Failed to recreate test case '${scenarioName}'`);
            }
        }
    }

    async getOrCreateTestCase(folderId, scenarioName, createTestCaseCallback) {
        try {
            const response = await axios.get(
                `${this.apiBaseUrl}/projects/${this.projectId}/test-cases?folder_id=${folderId}`,
                { auth: this.auth }
            );

            const existingTestCase = response.data?.test_cases?.find(tc => tc.title === scenarioName);

            if (existingTestCase) {
                console.log(`Test case '${scenarioName}' already exists with ID: ${existingTestCase.identifier}`);
                await this.handleExistingTestCase(existingTestCase, scenarioName, createTestCaseCallback);
                return;
            }

            console.log(`Creating new test case '${scenarioName}' in folder ID: ${folderId}`);
            const payload = await createTestCaseCallback(folderId);
            const createResponse = await axios.post(
                `${this.apiBaseUrl}/projects/${this.projectId}/folders/${folderId}/test-cases`,
                payload,
                { auth: this.auth }
            );

            const newTestCase = createResponse.data?.data?.test_case;
            if (newTestCase) {
                console.log(`Test case '${scenarioName}' created successfully with ID: ${newTestCase.identifier}`);
            } else {
                throw new Error(`Failed to create test case '${scenarioName}'`);
            }
        } catch (error) {
            console.error(`Error in getOrCreateTestCase: ${error.message}`);
            throw error;
        }
    }

    async updateTestCase(testCaseId, updateCallback) {
        try {
            const payload = await updateCallback();
            await axios.patch(
                `${this.apiBaseUrl}/projects/${this.projectId}/test-cases/${testCaseId}`,
                payload,
                { auth: this.auth }
            );
            console.log(`Test case updated successfully: ${testCaseId}`);
        } catch (error) {
            console.error(`Error updating test case: ${error.message}`);
            throw error;
        }
    }

    async deleteTestCase(testCaseId) {
        try {
            await axios.delete(
                `${this.apiBaseUrl}/projects/${this.projectId}/test-cases/${testCaseId}`,
                { auth: this.auth }
            );
            console.log(`Test case deleted successfully: ${testCaseId}`);
        } catch (error) {
            console.error(`Error deleting test case: ${error.message}`);
            throw error;
        }
    }

    async createTestCaseWithSteps(folderName, scenarioName, featureName, background, steps) {
        const folderId = await this.getOrCreateFolder(folderName);
        await this.getOrCreateTestCase(folderId, scenarioName, async (folderId) => {
            const testCaseSteps = steps.map(step => ({ step: `${step.keyword}${step.text}`, result: '' }));
            return {
                test_case: {
                    name: `${scenarioName}`,
                    template: 'test_case_steps',
                    description: `<p>${featureName} > ${scenarioName}</p>`,
                    preconditions: background,
                    test_case_steps: testCaseSteps
                },
            };
        });
    }

    async createBDDTestCase(folderName, scenarioName, featureName, background, steps) {
        const folderId = await this.getOrCreateFolder(folderName);
        await this.getOrCreateTestCase(folderId, scenarioName, async (folderId) => {
            const scenarioContent = steps.map(step => `\t${step.keyword}${step.text}`).join('\n');
            return {
                test_case: {
                    name: scenarioName,
                    template: 'test_case_bdd',
                    feature: featureName,
                    background: background,
                    description: `<p>${featureName} > ${scenarioName}</p>`,
                    preconditions: background && background.length > 0 ? `Background: ${background}` : undefined,
                    scenario: scenarioContent
                },
            };
        });
    }
}

module.exports = BrowserStackService;