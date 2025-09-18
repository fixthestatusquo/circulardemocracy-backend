
import fs from 'fs';
import path from 'path';
import app from '../src/api';

const spec = app.getOpenAPIDocument({
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

const outputPath = path.resolve(process.cwd(), 'doc/openapi.json');
fs.writeFileSync(outputPath, JSON.stringify(spec, null, 2));

console.log(`✅ OpenAPI specification generated at ${outputPath}`);
