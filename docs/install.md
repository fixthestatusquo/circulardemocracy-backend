# Installation Guide

## Project Setup Overview

This guide provides detailed installation instructions for the Circular Democracy Backend. For basic setup steps, see the Getting Started section in README.md. This guide focuses on environment configuration, API key setup, and production deployment considerations.

## Prerequisites

This guide assumes you have completed the basic setup from README.md:
- Node.js (v18 or higher)
- Docker (running)
- Supabase CLI installed

## Environment Configuration

### 1. Set Up Environment Variables

Create a `.env` file in the root directory with the following variables:

```bash
# Required for all CLI commands
SUPABASE_URL=your-supabase-url
SUPABASE_KEY=your-supabase-key

# Required for JMAP and email processing
STALWART_APP_PASSWORD=your-stalwart-app-password
STALWART_USERNAME=dibora  # optional, defaults to "dibora"

# Optional
STALWART_JMAP_ENDPOINT=https://mail.circulardemocracy.org/.well-known/jmap
```

### 2. Database Migration Setup

If this is your first setup, the database should already be initialized. For additional migrations:

```bash
# Reset database (destroy all data and reapply migrations)
npm run db:reset

# Apply new migrations
npm run db:push
```


## Environment Variables

### Required Variables

- `SUPABASE_URL`: Your Supabase project URL
- `SUPABASE_KEY`: Your Supabase service key
- `STALWART_APP_PASSWORD`: App password for Stalwart mail server
- `STALWART_USERNAME`: Username for Stalwart (default: "dibora")

### Optional Variables

- `STALWART_JMAP_ENDPOINT`: JMAP endpoint URL
- `OPENAI_API_KEY`: For Supabase AI features (if using)

### API Key Setup

For production deployment, you'll need to set up secure API keys:

```bash
# Example API key (replace with your secure key)
API_KEY=your_api_key_here
```

## Production Deployment

### Cloudflare Workers Setup

The API is designed to be deployed as a Cloudflare Worker:

```bash
# 1. Log in to Cloudflare
npx wrangler login

# 2. Set up secrets (required for production)
npx wrangler secret put SUPABASE_URL
npx wrangler secret put SUPABASE_KEY
npx wrangler secret put STALWART_APP_PASSWORD

# 3. Deploy the worker
npm run deploy
```

### CLI Tools Overview

The project includes CLI tools for message processing and management:

```bash
# Main CLI interface for campaign management
npx tsx bin/cli --help

# Manual message import for testing
npm run mail -- --help

# JMAP email ingestion from Stalwart
npm run jmap-fetch -- --help
```

## API Key Documentation

### Purpose

The API key is required for authentication and secure access to the API endpoints. It validates requests and ensures only authorized clients can interact with the system.

### Format Requirements

- **Type**: String value
- **Length**: 32-64 characters (recommended for production-grade security)
- **Characters**: Random alphanumeric string, no spaces
- **Usage**: Set as environment variable `API_KEY`

### Security Standards

**MUST Requirements:**
- Must be randomly generated with sufficient entropy
- Must never be hardcoded in source code
- Must never be committed to Git or version control
- Must be stored securely as environment variables

**SHOULD Requirements:**
- Should be at least 32 characters long
- Should use different keys for different environments
- Should be rotated regularly in production
- Should be generated using cryptographically secure methods

### Environment Variable Setup

Create or update your `.env` file:

```bash
# Example - replace with your generated secure key
API_KEY=your_api_key_here

# Example of a properly generated key (32 characters):
API_KEY=aB7xK9mP2qR5tY8wC1dF4gH7jK0lM3nO
```

### Generating Secure API Keys

Use one of these methods to generate a secure API key:

```bash
# Using OpenSSL (recommended)
openssl rand -base64 32

# Using Node.js
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"

# Using Python
python -c "import secrets; print(secrets.token_urlsafe(32))"
```

### Security Best Practices

1. **Environment Variables Only**: Always store API keys in environment variables, never in code
2. **Version Control Safety**: Add `.env` to `.gitignore` to prevent accidental commits
3. **Access Control**: Limit who has access to production API keys
4. **Regular Rotation**: Change API keys periodically, especially if compromised
5. **Environment Separation**: Use different keys for development, staging, and production

## Verification

To verify your installation:

1. **Database Check**: Ensure Supabase is running (`npm run db:start`)
2. **API Server**: Start development server (`npm run dev`)
3. **API Documentation**: Visit `http://localhost:8787/doc` for interactive API docs
4. **Test CLI**: Run `npx tsx bin/cli --help` to verify CLI tools work

## Troubleshooting

### Common Issues

1. **Docker not running**: Ensure Docker is running before `npm run db:start`
2. **Port conflicts**: Check if ports 54321-54327 are available
3. **Missing environment variables**: Verify all required variables are set in `.env`
4. **Node.js version**: Ensure you're using Node.js v18 or higher

### Getting Help

- Check the main README.md for detailed documentation
- Use `--help` flags on CLI commands for usage information
- Visit the API documentation at `/doc` endpoint when server is running
