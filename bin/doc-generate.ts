#!/usr/bin/env node

import fs from 'fs';
import path from 'path';

// Read OpenAPI spec
function loadOpenAPISpec(filePath = './doc/openapi.json') {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(content);
  } catch (error) {
    console.error(`Error loading OpenAPI spec from ${filePath}:`, error.message);
    process.exit(1);
  }
}

function generateMarkdownDocs(spec) {
  const { info, paths } = spec;
  
  let markdown = `# ${info.title}\n\n`;
  
  if (info.description) {
    markdown += `${info.description}\n\n`;
  }
  
  if (info.version) {
    markdown += `**Version:** ${info.version}\n\n`;
  }
  
  markdown += `## Endpoints\n\n`;
  
  Object.entries(paths).forEach(([path, methods]) => {
    markdown += `### ${path}\n\n`;
    
    Object.entries(methods).forEach(([method, operation]) => {
      markdown += `#### ${method.toUpperCase()}\n\n`;
      
      if (operation.summary) {
        markdown += `**Summary:** ${operation.summary}\n\n`;
      }
      
      if (operation.description) {
        markdown += `${operation.description}\n\n`;
      }
      
      // Parameters
      if (operation.parameters && operation.parameters.length > 0) {
        markdown += `**Parameters:**\n\n`;
        markdown += `| Name | Type | In | Required | Description |\n`;
        markdown += `|------|------|----|---------|--------------|\n`;
        
        operation.parameters.forEach(param => {
          const required = param.required ? '✓' : '';
          const description = param.description || '';
          const type = param.schema?.type || 'string';
          
          markdown += `| ${param.name} | ${type} | ${param.in} | ${required} | ${description} |\n`;
        });
        
        markdown += `\n`;
      }
      
      // Request body
      if (operation.requestBody) {
        markdown += `**Request Body:**\n\n`;
        const content = operation.requestBody.content;
        Object.entries(content).forEach(([mediaType, schema]) => {
          markdown += `Content-Type: \`${mediaType}\`\n\n`;
          if (schema.schema && schema.schema.properties) {
            markdown += `| Property | Type | Required | Description |\n`;
            markdown += `|----------|------|----------|--------------|\n`;
            
            const required = schema.schema.required || [];
            Object.entries(schema.schema.properties).forEach(([prop, propSchema]) => {
              const isRequired = required.includes(prop) ? '✓' : '';
              const type = propSchema.type || 'string';
              const description = propSchema.description || '';
              
              markdown += `| ${prop} | ${type} | ${isRequired} | ${description} |\n`;
            });
            markdown += `\n`;
          }
        });
      }
      
      // Responses
      if (operation.responses) {
        markdown += `**Responses:**\n\n`;
        Object.entries(operation.responses).forEach(([code, response]) => {
          markdown += `- **${code}**: ${response.description || 'No description'}\n`;
        });
        markdown += `\n`;
      }
      
      // CLI Example
      markdown += `**CLI Example:**\n\n`;
      let cliExample = `./cli ${path}`;
      
      if (method.toUpperCase() !== 'GET') {
        cliExample += ` --method=${method.toUpperCase()}`;
      }
      
      // Add parameter examples
      if (operation.parameters) {
        operation.parameters.forEach(param => {
          if (param.in === 'path') {
            cliExample = cliExample.replace(`{${param.name}}`, `--${param.name}=123`);
          } else if (param.in === 'query') {
            cliExample += ` --${param.name}=example`;
          }
        });
      }
      
      if (operation.requestBody) {
        cliExample += ` --name=example --param=value`;
      }
      
      markdown += `\`\`\`bash\n${cliExample}\n\`\`\`\n\n`;
      
      markdown += `---\n\n`;
    });
  });
  
  return markdown;
}

function generateCliHelp(spec) {
  const { paths } = spec;
  const endpoints = [];
  
  Object.entries(paths).forEach(([path, methods]) => {
    Object.entries(methods).forEach(([method, operation]) => {
      const endpoint = {
        path,
        method: method.toUpperCase(),
        summary: operation.summary || '',
        parameters: [],
        requestBodyProps: []
      };
      
      // Collect parameters
      if (operation.parameters) {
        operation.parameters.forEach(param => {
          endpoint.parameters.push({
            name: param.name,
            type: param.schema?.type || 'string',
            in: param.in,
            required: param.required || false,
            description: param.description || ''
          });
        });
      }
      
      // Collect request body properties
      if (operation.requestBody && operation.requestBody.content) {
        Object.values(operation.requestBody.content).forEach(content => {
          if (content.schema && content.schema.properties) {
            const required = content.schema.required || [];
            Object.entries(content.schema.properties).forEach(([prop, propSchema]) => {
              endpoint.requestBodyProps.push({
                name: prop,
                type: propSchema.type || 'string',
                required: required.includes(prop),
                description: propSchema.description || ''
              });
            });
          }
        });
      }
      
      endpoints.push(endpoint);
    });
  });
  
  return endpoints;
}

// Format CLI help output
function formatCliHelp(endpoints, filter = '') {
  let output = '\nAvailable endpoints:\n\n';
  
  const filtered = filter 
    ? endpoints.filter(e => 
        e.path.includes(filter) || 
        e.method.includes(filter.toUpperCase()) ||
        e.summary.toLowerCase().includes(filter.toLowerCase())
      )
    : endpoints;
  
  filtered.forEach(endpoint => {
    output += `${endpoint.method} ${endpoint.path}\n`;
    if (endpoint.summary) {
      output += `  ${endpoint.summary}\n`;
    }
    
    if (endpoint.parameters.length > 0) {
      output += '  Parameters:\n';
      endpoint.parameters.forEach(param => {
        const req = param.required ? '(required)' : '(optional)';
        output += `    --${param.name} (${param.type}, ${param.in}) ${req}\n`;
        if (param.description) {
          output += `      ${param.description}\n`;
        }
      });
    }
    
    if (endpoint.requestBodyProps.length > 0) {
      output += '  Body properties:\n';
      endpoint.requestBodyProps.forEach(prop => {
        const req = prop.required ? '(required)' : '(optional)';
        output += `    --${prop.name} (${prop.type}) ${req}\n`;
        if (prop.description) {
          output += `      ${prop.description}\n`;
        }
      });
    }
    
    output += '\n';
  });
  
  return output;
}

// Main execution
const command = process.argv[2];
const filter = process.argv[3];

if (command === 'markdown') {
  const spec = loadOpenAPISpec();
  const markdown = generateMarkdownDocs(spec);
  fs.writeFileSync('./doc/API.md', markdown);
  console.log('📝 Generated API.md');
} else if (command === 'help') {
  const spec = loadOpenAPISpec();
  const endpoints = generateCliHelp(spec);
  console.log(formatCliHelp(endpoints, filter));
} else if (command === 'json') {
  const spec = loadOpenAPISpec();
  const endpoints = generateCliHelp(spec);
  fs.writeFileSync('endpoints.json', JSON.stringify(endpoints, null, 2));
  console.log('📄 Generated endpoints.json');
} else {
  console.log(`
Usage: node doc-generate.js <command> [filter]

Commands:
  markdown    Generate API.md documentation
  help        Show CLI help (optionally filtered)
  json        Generate endpoints.json data

Examples:
  node doc-generate.js markdown
  node doc-generate.js help campaigns
  node doc-generate.js help GET
  node doc-generate.js json
`)};
