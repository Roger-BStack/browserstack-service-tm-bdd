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

    async traverseDirectory(directory, parentFolderId = null) {
        const preserveDirStructure = process.env.PRESERVE_DIRECTORY_STRUCTURE === 'true';
        const files = fs.readdirSync(directory);

        for (const file of files) {
            const fullPath = path.join(directory, file);
            const stat = fs.statSync(fullPath);
            console.log(`Processing: ${fullPath} for Project ID: ${this.projectId}`);
            if (stat.isDirectory()) {
                console.log(`Processing folder: ${file}`);
                let folderId = null;

                if (preserveDirStructure) {
                    folderId = await this.getOrCreateFolder(file, parentFolderId);
                }

                await this.traverseDirectory(fullPath, preserveDirStructure ? folderId : parentFolderId);
            } else if (file.endsWith('.feature')) {
                console.log(`Processing feature file: ${file}`);

                await this.processFeatureFile(fullPath, parentFolderId);
            }
        }
    }

    async processFeatureFile(filePath, parentFolderId) {
        const featureContent = fs.readFileSync(filePath, 'utf8');

        const options = {
            includeSource: false,
            includeGherkinDocument: true,
            includePickles: false,
        };
        const stream = GherkinStreams.fromPaths([filePath], options);

        for await (const message of stream) {
            // Process the message (e.g., a GherkinDocument, a Pickle, or a Source message)
            if (message.gherkinDocument) {
                console.log('Parsed Feature Name:', message.gherkinDocument.feature.name);
                await this.processGherkinDocument(message.gherkinDocument, filePath, parentFolderId);
            }
        }
    }

    async processGherkinDocument(gherkinDocument, filePath, parentFolderId) {
        const feature = gherkinDocument.feature;
        if (feature) {
            console.log(`Feature Name: ${feature.name}`);

            const featureFolderName = path.basename(filePath);
            const featureFolderId = await this.getOrCreateFolder(featureFolderName, parentFolderId);

            for (const scenario of feature.children) {
                if (scenario.scenario) {
                    console.log(`\n  Scenario Name: ${scenario.scenario.name}`);
                    for (const step of scenario.scenario.steps) {
                        console.log(`    Step: ${step.keyword.trim()} ${step.text}`);
                    }
                    console.log(`\nUploading Scenario: ${scenario.scenario.name}`);
                    await this.uploadPickleScenario(filePath, feature.name, scenario.scenario, featureFolderId);
                }
            }
        }
    }

    async uploadPickleScenario(featureFilePath, featureName, scenario, parentFolderId) {
        const folderName = path.basename(featureFilePath); // Use full feature file name as folder name
        const scenarioName = scenario.name;
        const background = scenario.steps.filter(step => step.keyword === 'Background').map(step => step.text).join('\n');

        // Determine the test case template based on configuration
        const testCaseTemplate = process.env.TEST_CASE_TEMPLATE || 'bdd'; // Default to 'bdd'

        if (testCaseTemplate === 'steps') {
            console.log(`Uploading as Test Case with Steps: ${scenarioName}`);
            await this.createTestCaseWithSteps(folderName, scenarioName, featureName, background, scenario.steps, parentFolderId);
        } else if (testCaseTemplate === 'bdd') {
            console.log(`Uploading as BDD Test Case: ${scenarioName}`);
            await this.createBDDTestCase(folderName, scenarioName, featureName, background, scenario.steps, parentFolderId);
        } else {
            console.error(`Invalid TEST_CASE_TEMPLATE value: ${testCaseTemplate}. Must be 'steps' or 'bdd'.`);
            throw new Error(`Invalid TEST_CASE_TEMPLATE value: ${testCaseTemplate}`);
        }
    }

    async fetchAllFolders(parentFolderId = null) {
        let folders = [];
        let nextPage = 1;

        try {
            while (nextPage) {
                let response;
                if (parentFolderId) {
                    console.log(`Fetching folders under Parent ID: ${parentFolderId}, Page: ${nextPage}`);
                    response = await axios.get(
                        `${this.apiBaseUrl}/projects/${this.projectId}/folders/${parentFolderId}/sub-folders?p=${nextPage}`,
                        { auth: this.auth }
                    );
                } else {
                    console.log(`Fetching root folders, Page: ${nextPage}`);
                    response = await axios.get(
                        `${this.apiBaseUrl}/projects/${this.projectId}/folders?p=${nextPage}`,
                        { auth: this.auth }
                    );
                }

                if (response.data && response.data.folders) {
                    folders = folders.concat(response.data.folders);
                    nextPage = response.data.info?.next || null;
                } else {
                    break;
                }
            }
        } catch (error) {
            console.error(`Error fetching folders: ${error.message}`);
            throw error;
        }

        return folders;
    }

    async getOrCreateFolder(folderName, parentFolderId = null) {
        try {
            const folders = await this.fetchAllFolders(parentFolderId);

            const existingFolder = folders.find(folder => folder.name === folderName && folder.parent_id === parentFolderId);
            if (existingFolder) {
                console.log(`Folder '${folderName}' already exists with ID: ${existingFolder.id}`);
                return existingFolder.id;
            }

            // Folder does not exist, create a new one
            const createResponse = await axios.post(
                `${this.apiBaseUrl}/projects/${this.projectId}/folders`,
                { folder: { name: folderName, description: `Folder for feature: ${folderName}`, parent_id: parentFolderId } },
                { auth: this.auth }
            );

            if (createResponse.data && createResponse.data.folder) {
                console.log(`Created new folder '${folderName}' with ID: ${createResponse.data.folder.id} under parent ID: ${parentFolderId}`);
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
            const folderId = existingTestCase.folder_id;
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

    async createTestCaseWithSteps(folderName, scenarioName, featureName, background, steps, parentFolderId) {
        await this.getOrCreateTestCase(parentFolderId, scenarioName, async (folderId) => {
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

    async createBDDTestCase(folderName, scenarioName, featureName, background, steps, parentFolderId) {
        await this.getOrCreateTestCase(parentFolderId, scenarioName, async (folderId) => {
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