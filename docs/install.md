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

# Single outbound JMAP relay service account (required):
JMAP_URL=https://mail.example.org
SUPABASE_ANON_KEY=your-supabase-anon-key
RELAY_SERVICE_ACCOUNT_EMAIL=relay-user@example.org
RELAY_SERVICE_ACCOUNT_PASSWORD=relay-user-password
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

Outbound replies use one global service account for authentication:

- `JMAP_URL` (base mail server; the worker uses `JMAP_URL/.well-known/jmap` for the JMAP session document)
- `SUPABASE_ANON_KEY`
- `RELAY_SERVICE_ACCOUNT_EMAIL`
- `RELAY_SERVICE_ACCOUNT_PASSWORD`

### Optional Variables

### Configure Service Account Credentials

Set `JMAP_URL`, `RELAY_SERVICE_ACCOUNT_EMAIL`, and `RELAY_SERVICE_ACCOUNT_PASSWORD` in the same runtime as the API (`.env` locally, Worker secrets in production).

### Reply sends (brief)

- Each `messages` row is sent at most once by the worker: after success, `reply_sent_at` is set and `reply_status` is `sent`.
- Inbound auto-replies are only scheduled for the first message per supporter + campaign (`duplicate_rank === 0`); see README “Reply deduplication and persistence” for full detail.

## Production Deployment

### Cloudflare Workers Setup

The API is designed to be deployed as a Cloudflare Worker:

```bash
# 1. Log in to Cloudflare
npx wrangler login

# 2. Set up secrets (required for production)
npx wrangler secret put SUPABASE_URL
npx wrangler secret put SUPABASE_KEY
npx wrangler secret put JMAP_URL
npx wrangler secret put SUPABASE_ANON_KEY
npx wrangler secret put RELAY_SERVICE_ACCOUNT_EMAIL
npx wrangler secret put RELAY_SERVICE_ACCOUNT_PASSWORD

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
