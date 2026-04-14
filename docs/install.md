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
STALWART_USERNAME=your-stalwart-username

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
- `STALWART_USERNAME`: Username for Stalwart

### Optional Variables

- `STALWART_JMAP_ENDPOINT`: JMAP endpoint URL

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

## API Key Setup

The API key protects authenticated API endpoints.

1. Generate a secure key:
   ```bash
   openssl rand -base64 32
   ```
2. Set it as `API_KEY` in one of:
   - local `.env` for development
   - Cloudflare secrets (`wrangler secret put API_KEY`) for Workers
   - service environment (`systemd` unit environment or equivalent) for server deployments
3. Do not commit keys to version control.

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
