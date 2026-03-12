
import fs from 'fs';
import path from 'path';
import app from '../src/api';
import stalwartApp from '../src/stalwart';

// Generate spec for main API
const mainSpec = app.getOpenAPIDocument({
    openapi: '3.0.0',
    info: {
        version: '1.0.0',
        title: 'Circular Democracy API',
        description: 'API for processing citizen messages to politicians'
    },
    servers: [
        {
            url: 'https://api.circulardemocracy.org',
            description: 'Production server'
        },
        {
            url: 'http://localhost:8787',
            description: 'Development server'
        }
    ]
});

// Generate spec for Stalwart app
const stalwartSpec = stalwartApp.getOpenAPIDocument({
    openapi: '3.0.0',
    info: {
        version: '1.0.0',
        title: 'Stalwart MTA Hook API',
        description: 'Processes incoming emails via Stalwart mail server hooks'
    },
    servers: [
        {
            url: 'https://stalwart.circulardemocracy.org',
            description: 'Production Stalwart hook server'
        },
    ]
});

// Combine the specs
const combinedSpec = {
    ...mainSpec,
    paths: {
        ...mainSpec.paths,
        ...stalwartSpec.paths
    },
    // Merge tags if needed
    tags: [
        ...(mainSpec.tags || []),
        ...(stalwartSpec.tags || [])
    ]
};

const outputPath = path.resolve(process.cwd(), 'doc/openapi.json');
fs.writeFileSync(outputPath, JSON.stringify(combinedSpec, null, 2));

console.log(`✅ OpenAPI specification generated at ${outputPath}`);
