# Circular Democracy Backend

A democratic engagement platform that enables citizens to communicate directly with their elected representatives and facilitates meaningful two-way dialogue between constituents and politicians.

## Overview

Circular Democracy is designed to bridge the communication gap between citizens and their elected representatives by providing a structured system for message routing, classification, and response management. The platform processes citizen messages through multiple channels, intelligently categorizes them by campaign/topic, and enables politicians to send personalized replies to their constituents.

Many citizens write to their elected representatives as part of campaigns organised by NGOs. This will be a mix of pre-written messages (copypasta activism) and more personal and customised onces that are part of a campaign (these two are the bulk of the email received) and some edge cases of someone using the campaign but writting on a different topic.

In order to be able let the politicians understand the size of each campaign and their volume of activity at any given time, and to be able to reply automatically (at least when that's the same pre-written messages), we first need to classify these emails

For privacy reasons, we are trying to minimise the personal information of each supporter to the strict minimum possible. For instance, the AI model used to classify a message won't use the name or email of the supporter to be able to decide what is the campaign (if any) that enpowered the supporter to write, so it shouldn't have access to these data.

For performance reasons, it should be noted that it's quite common that the same supporter will send almost identical emails (may be with the first line "Dear representative Smith", "Dear representative Doe" being different), and in principle, there is no need classify each of them, or at least avoid overfitting the model because of these duplicates.

## Key Features

### 🔄 Multi-Channel Message Processing

- **REST API**: Integration with NGO campaign tools and citizen engagement platforms
- **CLI Tools**: 
  - `mail` - Manual message import for testing and development
  - `jmap-fetch` - Automated JMAP ingestion from Stalwart mail server
- **Email Integration**: Direct email processing via Stalwart mail server with MTA hooks
- **Unified Processing**: All messages flow through the same classification and routing system

### 🤖 Intelligent Message Classification

- **AI-Powered Clustering**: Uses BGE-M3 embeddings via Cloudflare Workers AI for semantic message analysis
- **Campaign Detection**: Automatically identifies which political campaign or issue a message relates to
- **Multi-Language Support**: Processes messages in multiple languages with sentiment analysis capabilities
- **Duplicate Detection**: Handles multiple messages from the same citizen with spam prevention

### 📊 Analytics & Insights Dashboard

- **Campaign Metrics**: Track number of actions and engagement per campaign
- **Activity Trends**: Monitor active campaigns with 7-day activity windows
- **Email Analytics**: Detailed statistics grouped by day and campaign
- **Benchmarking**: Cross-party and cross-regional comparison tools (planned)
- **Population-Adjusted Metrics**: Meaningful comparisons accounting for constituency size differences

### 💌 Automated Response System

- **Template Management**: Politicians can create custom reply templates for different campaigns
- **Scheduled Responses**: Flexible timing options (immediate, office hours, before votes)
- **Personalization**: Support for headers, contact details, and politician branding
- **Delivery Tracking**: Monitor when and what was sent to each supporter

### 🛡️ Privacy-First Architecture

- **Two-Tier Storage System**:
  - **Long-term**: Analytics data and model training (anonymized)
  - **Short-term**: Personal information (deleted after reply sent)
- **Data Minimization**: Personal data retained only as long as necessary
- **Hashed Identifiers**: Citizen privacy protected through email hashing

## Technical Architecture

### Core Components

#### Message Processing Pipeline

1. **Input Channels** → REST API, CLI, or Email (Stalwart webhook)
2. **Classification** → BGE-M3 embedding generation and campaign clustering
3. **Storage** → Dual storage system (analytics + temporary personal data)
4. **Response Management** → Template-based automated replies
5. **Analytics** → Real-time dashboard and reporting

#### Data Models

**Long-term Storage (Analytics)**

- Message ID (UUID)
- Channel source (API/email server)
- Timestamp
- Sender ID (hashed email)
- Campaign classification
- BGE-M3 vector (1024 dimensions)
- Reply metadata

**Short-term Storage (Personal Data)**

- Sender name and email
- Original message content
- Timestamp
- Reply requirements

### Technology Stack

- **Database**: Supabase with vector storage support
- **AI/ML**: Cloudflare Workers AI (BGE-M3 model)
- **Email**: Stalwart mail server with MTA hooks
- **Authentication**: Supabase Auth (MVP), OAuth (planned)
- **Message Queue**: RabbitMQ integration (shared with Proca infrastructure)

## Documentation

### `/doc` - Interactive API Documentation

When running the development server (`npm run dev`), you can access the complete interactive API documentation at:

```
http://localhost:3000/doc
```

This endpoint displays the `doc/openapi.html` file and provides access to **all API endpoints** with an interactive UI for testing and exploration. The documentation includes:

- **Complete API Reference**: All endpoints with `/api/v1/xxx` URL format
- **Endpoint Descriptions**: Available descriptions for each endpoint (e.g., "Get campaign statistics")
- **Interactive Testing**: Try endpoints directly from your browser
- **Request/Response Examples**: Clear examples for all API calls
- **Authentication Information**: Bearer token authentication details

### Documentation Files

Generated documentation files are located in the `doc/` directory:

- **OpenAPI specification**: [`doc/openapi.json`](doc/openapi.json) - Machine-readable API specification
- **HTML API docs**: [`doc/openapi.html`](doc/openapi.html) - Interactive web documentation (served at `/doc`)
- **Markdown API docs**: [`doc/API.md`](doc/API.md) - Static markdown documentation

### Updating OpenAPI Documentation

The OpenAPI specification is automatically generated from the API routes and schemas defined in the codebase using Hono's OpenAPI integration with Zod schemas.

#### When to Update Documentation

Update the documentation whenever you:
- Add new API endpoints
- Modify existing endpoint schemas
- Update request/response parameters
- Change authentication requirements

#### Update Process

1. **Update API routes/schemas** - Modify your API definitions in files such as:
   - `src/api.ts` - Main API routes and configurations
   - `src/messages.ts` - Message-related endpoints
   - `src/campaigns.ts` - Campaign management endpoints
   - `src/politicians.ts` - Politician-related endpoints
   - `src/reply_templates.ts` - Reply template functionality

2. **Regenerate the OpenAPI JSON specification**:
   ```bash
   npm run doc:spec
   ```
   This command processes your Hono routes and Zod schemas to generate `doc/openapi.json`.

3. **Generate updated documentation**:
   ```bash
   # Generate HTML docs from the OpenAPI specification
   npm run doc:html
   
   # Generate Markdown API documentation
   npm run doc:md
   
   # Or run all documentation generation steps at once:
   npm run doc:build
   ```

4. **Verify the documentation**:
   - Start the development server: `npm run dev`
   - Visit `http://localhost:3000/doc` to view the updated documentation
   - Test the interactive features to ensure everything works correctly

### Development Workflow

1. Make changes to your API routes or Zod schemas
2. Run `npm run doc:spec` to update the OpenAPI specification
3. Run `npm run doc:html` to regenerate the HTML documentation
4. Access the updated documentation at `http://localhost:3000/doc` (with dev server running)
5. Optionally run `npm run doc:build` to update all documentation formats at once

### Documentation Features

- **Auto-generated**: Documentation is generated directly from your code
- **Always up-to-date**: Reflects the current API implementation
- **Interactive testing**: Try API calls directly from the browser
- **Comprehensive coverage**: Includes all endpoints with proper descriptions
- **Multiple formats**: Available as HTML, JSON, and Markdown

## API Endpoints

### REST API Input Channel

```
POST /api/messages
```

**Request Body:**

```json
{
  "messageid": "uuid-string",
  "sender_name": "string",
  "sender_email": "string",
  "subject": "string",
  "message": "string",
  "timestamp": "ISO-8601",
  "campaign_name": "string (optional)"
}
```

### Stalwart Webhook

Integration with mail server MTA hooks for direct email processing with automatic folder organization by campaign.

### CLI Tools

The platform provides several command-line tools for message ingestion, campaign management, and system administration.

**Environment Variables (set once):**

All CLI entrypoints load `.env` via `dotenv`, so set these once and reuse across commands:

```bash
# Required for all CLI commands
export SUPABASE_URL="your-supabase-url"
export SUPABASE_KEY="your-supabase-key"
# Required for JMAP commands (`jmap-fetch`, `reprocess-messages`)
export STALWART_APP_PASSWORD="your-stalwart-app-password"
export STALWART_USERNAME="your-stalwart-username"

# Optional
export STALWART_JMAP_ENDPOINT="https://mail.circulardemocracy.org/.well-known/jmap"
```

#### 1. Main CLI Interface (`./bin/cli`)

The primary CLI tool for campaign management, authentication, and API access.

**Usage:**

```bash
npx tsx bin/cli <command> [options]
```

**Authentication Commands:**

- `login`: Authenticate with the API
- `logout`: Clear authentication session

**Campaign Management:**

- `add-campaign`: Create a new campaign with embedding
- `update-campaign`: Update campaign embedding and/or name
- `assign-cluster`: Assign a campaign to one inferred message cluster
- `sync-clusters`: Bulk sync all already-assigned clusters into messages (useful after backfills/imports)

Use `assign-cluster` for one manual decision. Use `sync-clusters` after many assignments or data backfills to propagate cluster campaign IDs to matching messages in bulk.

**Message Processing:**

- `jmap-fetch`: Fetch new mail from Stalwart and process/store/classify it
- `reprocess-messages`: Recompute embeddings/classification for already stored messages
- `<endpoint>`: Direct API endpoint access (e.g., campaigns, users/:id)

**Campaign Management Examples:**

```bash
# Create campaign with representative text used to compute the campaign embedding vector
npx tsx bin/cli add-campaign --name "Climate Action" --text "I urge action on climate change" --description "Environmental campaign"

# Create campaign from URL (extracts subdomain as name and content as text)
npx tsx bin/cli add-campaign --url "https://climate.example.com/action" --name "Override Name"

# Update campaign representative text (regenerates the campaign embedding vector) or update only name
npx tsx bin/cli update-campaign --id 5 --text "Updated representative text used for campaign embeddings"
npx tsx bin/cli update-campaign --id 5 --name "New Campaign Name"
npx tsx bin/cli update-campaign --id 5 --url "https://climate.example.com/new-page"

# Assign one cluster, then run bulk sync if needed
npx tsx bin/cli assign-cluster --cluster-id 123 --campaign-name "Climate Action"
npx tsx bin/cli sync-clusters
```

**Message Reprocessing Examples:**

```bash
npx tsx bin/cli reprocess-messages --process-all
npx tsx bin/cli reprocess-messages --campaign-id 5 --limit 100
npx tsx bin/cli reprocess-messages --since "2024-03-01"
npx tsx bin/cli reprocess-messages --process-all --dry-run
npx tsx bin/cli reprocess-messages --process-all --no-move-to-folders
```

**API Access Examples:**

```bash
# List campaigns
npx tsx bin/cli campaigns

# Get specific campaign
npx tsx bin/cli campaigns/123

# Update campaign via API
npx tsx bin/cli campaigns/123 --name=updated --method=PUT

# List available servers
npx tsx bin/cli --list-servers

# Use specific server
npx tsx bin/cli campaigns --server=production
```

**API Options:**

- `-m, --method`: HTTP method (GET, POST, PUT, DELETE) [default: GET]
- `-s, --server`: Server to use (index or description) [default: 0]
- `-l, --list-servers`: List available servers from OpenAPI spec
- `-h, --help`: Show help message
- `-v, --version`: Show version

#### 2. Manual Message Import (`mail`)

For testing and manual message imports with flag-based arguments.

**Usage:**

```bash
npm run mail -- --message-id <id> --recipient-email <email> --sender-name <name> \
    --sender-email <email> --subject <subject> --message <message> \
    --timestamp <iso8601> [--campaign-name <name>]
```

**Required Arguments:**

- `--message-id`: Unique identifier for the message
- `--recipient-email`: Email address of the target politician  
- `--sender-name`: Full name of the message sender
- `--sender-email`: Email address of the sender
- `--subject`: Message subject line
- `--message`: Message body content (min 10 chars, max 10000 chars)
- `--timestamp`: When the message was originally sent (ISO 8601 format)

**Optional Arguments:**

- `--campaign-name`: Optional campaign name hint for classification
- `--channel-source`: Source system identifier (default: "cli")

**Example:**

```bash
npm run mail -- \
  --message-id "msg-123" \
  --recipient-email "politician@example.com" \
  --sender-name "John Doe" \
  --sender-email "john@example.com" \
  --subject "Support for Clean Water Initiative" \
  --message "I strongly support the clean water initiative and believe it's crucial for our community's health." \
  --timestamp "2024-03-15T10:30:00Z" \
  --campaign-name "Clean Water"
```

#### 3. JMAP Automated Ingestion (`jmap-fetch`)

For automated ingestion from Stalwart mail server using JMAP protocol.

**Usage:**

```bash
npm run jmap-fetch -- [--user <username>] [--password <password>] [options]
```

**Options:**

- `--user <username>`: JMAP username (default: `STALWART_USERNAME` env)
- `--password <password>`: JMAP app password (default: `STALWART_APP_PASSWORD` env)
- `--process-all`: Fetch all available messages (default when no filter provided)
- `--since <date>`: Fetch messages received after a date (ISO 8601)
- `--message-id <id>`: Fetch one specific message (JMAP ID or Message-ID header)
- `--dry-run`: Preview converted messages without processing/storage
- `-h, --help`: Show help message

**Examples:**

```bash
# Fetch all messages
npm run jmap-fetch -- --process-all

# Fetch messages since a specific date
npm run jmap-fetch -- --since "2024-03-01"

# Fetch a specific message
npm run jmap-fetch -- --message-id "specific-id"

# Dry run to preview without processing
npm run jmap-fetch -- --dry-run --since "2024-03-01"

# Optional: override credentials from environment variables
npm run jmap-fetch -- --user dibora --password mypass --process-all

```

#### 4. Message Reprocessing (`reprocess-messages`)

Recompute embeddings and classifications for existing messages.

**Usage:**

```bash
# Method 1: Through main CLI (recommended)
npx tsx bin/cli reprocess-messages [options]

# Method 2: Direct execution
npx tsx bin/reprocess-messages.ts [options]
```

**Options:**

- `--user <username>`: JMAP username (default: `STALWART_USERNAME` env)
- `--password <password>`: JMAP app password (default: `STALWART_APP_PASSWORD` env)
- `--process-all`: Reprocess uncategorized messages from Stalwart inbox (no campaign_id or campaign_id 472)
- `--campaign-id <id>`: Only reprocess messages for a specific campaign
- `--since <date>`: Only reprocess messages received after a date (ISO 8601)
- `--limit <number>`: Maximum number of messages to reprocess
- `--no-move-to-folders`: Disable moving messages to campaign folders after reclassification (enabled by default unless `--dry-run`)
- `--dry-run`: Preview messages without reprocessing
- `-h, --help`: Show help message

**Examples:**

```bash
npx tsx bin/cli reprocess-messages --process-all
npx tsx bin/reprocess-messages.ts --process-all
npx tsx bin/reprocess-messages.ts --limit 100
npx tsx bin/reprocess-messages.ts --campaign-id 5
npx tsx bin/reprocess-messages.ts --since "2024-03-01"
npx tsx bin/reprocess-messages.ts --dry-run --limit 10
npx tsx bin/reprocess-messages.ts --process-all --no-move-to-folders
```

#### Getting Help

```bash
# Main CLI help (shows all available commands)
npx tsx bin/cli --help

# Manual import help
npm run mail -- --help

# JMAP fetch help
npm run jmap-fetch -- --help

# Reprocess messages help (use direct execution for detailed help)
npx tsx bin/reprocess-messages.ts --help

# Note: npx tsx bin/cli reprocess-messages --help shows general CLI help, 
# not command-specific help. Use direct execution for detailed command help.
```

### Analytics API

- Campaign overview statistics
- Active campaign metrics (7-day windows)
- Email volume by day/campaign
- Bounce and delivery tracking

## Authentication

Certain endpoints, such as `/api/v1/campaigns/stats`, require authentication. This API uses JSON Web Tokens (JWTs) issued by Supabase Auth.

To access protected endpoints, clients must include a valid JWT in the `Authorization` header as a Bearer token.

**Example Request:**

```
GET /api/v1/campaigns/stats
Host: <your-worker-url>
Authorization: Bearer <your-supabase-jwt>
```

### Obtaining a JWT

On a client-side application (e.g., a React or Vue dashboard), you would use the Supabase client library (`@supabase/supabase-js`) to handle user login. After a user successfully signs in, you can retrieve the JWT from the user's session.

```javascript
// Example using supabase-js on a frontend
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(YOUR_SUPABASE_URL, YOUR_SUPABASE_ANON_KEY);

// After user logs in...
const { data, error } = await supabase.auth.signInWithPassword({
  email: "user@example.com",
  password: "password",
});

if (data.session) {
  const jwt = data.session.access_token;

  // Now use this JWT to make requests to the protected API endpoints
  fetch("https://<your-worker-url>/api/v1/campaigns/stats", {
    headers: {
      Authorization: `Bearer ${jwt}`,
    },
  });
}
```

## Getting Started

This guide will walk you through setting up the project for local development, including running the database and the API server.

### Prerequisites

- [Node.js](https://nodejs.org/) (v18 or higher)
- [Docker](https://www.docker.com/get-started) (for running the local database)
- [Supabase CLI](https://supabase.com/docs/guides/cli) (for database migrations)

### Local Development Setup

1.  **Clone the Repository**

    ```bash
    git clone https://github.com/fixthestatusquo/circulardemocracy-backend.git
    cd circulardemocracy-backend
    ```

2.  **Install Dependencies**

    ```bash
    npm install
    ```

3.  **Start the Local Database**

    This project uses the Supabase CLI to run a local, containerized version of the entire Supabase stack (Postgres, GoTrue, etc.).

    ```bash
    # This command requires Docker to be running
    npm run db:start
    ```

    The first time you run this, it will download the necessary Docker images. Once started, you'll see output with your local database credentials and API keys. These are safe to use for local development.

4.  **Run the API Development Server**

    In a separate terminal, start the Hono API server, which will connect to your local database.

    ```bash
    npm run dev
    ```

    The server will typically be available at `http://localhost:8787`.

## Database Schema Management

This project uses the Supabase CLI to manage database schema changes through migration files located in the `supabase/migrations` directory. **Never edit your production database schema through the Supabase web UI.** Always create a migration file and apply it.

Here is the recommended workflow and an explanation of the helper scripts:

- `npm run db:start`
  - **What it does:** Starts the local Supabase Docker containers.
  - **When to use it:** At the beginning of every development session.

- `npm run db:reset`
  - **What it does:** Stops the local database, destroys all data, and restarts it by re-applying all migration files from scratch.
  - **When to use it:** When you need a clean slate or want to test the entire migration process.

- `npm run db:diff -- <migration_name>`
  - **What it does:** Compares the current state of your local database with the last migration file and generates a _new_ migration file containing the differences.
  - **When to use it:** After you have made schema changes to your local database (e.g., using a GUI tool or `psql`) and want to commit those changes to a new migration file.
  - **Example:** `npm run db:diff -- add_user_profiles`

- `npm run db:push`
  - **What it does:** Applies any new, un-applied migration files to your remote (production) Supabase database.
  - **When to use it:** When you are ready to deploy your schema changes to production. You must first link your project with `supabase link --project-ref <your-project-ref>`.

### Typical Workflow for a Schema Change

1.  Make sure your local database is running (`npm run db:start`).
2.  Connect to the local database with your preferred tool and make your schema changes (e.g., `CREATE TABLE ...`, `ALTER TABLE ...`).
3.  Generate a new migration file to capture your changes:
    ```bash
    npm run db:diff -- name_of_your_change
    ```
4.  Commit the new file in `supabase/migrations` to Git.
5.  When ready to deploy, push the changes to your live Supabase project:
    ```bash
    npm run db:push
    ```

## Deployment

This API is designed to be deployed as a Cloudflare Worker. The `wrangler` CLI, which is included as a dev dependency, is used for deployment.

1.  **Log in to Cloudflare**

    First, you need to authenticate with your Cloudflare account.

    ```bash
    npx wrangler login
    ```

2.  **Set Up Secrets**

    The worker needs access to your Supabase credentials. These should be stored as encrypted secrets in your Cloudflare account, not in version control. Your code requires two secrets: `SUPABASE_URL` and `SUPABASE_KEY`.

    Run the following commands, pasting your actual Supabase URL and Key when prompted:

    ```bash
    npx wrangler secret put SUPABASE_URL
    npx wrangler secret put SUPABASE_KEY
    ```

3.  **Deploy the Worker**

    Once your secrets are set, you can deploy the worker using the built-in npm script:

    ```bash
    npm run deploy
    ```

    This command bundles your code and uploads it to your Cloudflare account, making it available at the URL provided in the output.

## Roadmap

### MVP (Current Focus)

- ✅ Basic message ingestion (REST API + Email)
- ✅ BGE-M3 embedding and clustering
- ✅ Simple campaign classification
- ✅ Basic reply system
- ✅ Supabase authentication
- ⏳ Core analytics dashboard

### Post-MVP Enhancements

- **Advanced Classification**: Multi-category clustering and sentiment analysis
- **Enhanced Analytics**: Cross-party benchmarking and advanced metrics
- **Bounce Management**: Comprehensive email delivery monitoring
- **Template System**: Rich reply templates with scheduling options
- **Multi-lingual Support**: Enhanced language detection and processing

## Privacy & Data Handling

The platform is designed with privacy-by-design principles:

- **Minimal Data Retention**: Personal information deleted after response sent
- **Anonymized Analytics**: Long-term storage contains only hashed identifiers
- **Secure Processing**: All personal data handling follows GDPR principles
- **Transparent Tracking**: Citizens know when and how their messages are processed

## Related Projects

Proca: Campaign action processing infrastructure (shared message queue)
Fix the Status Quo: Parent organization's civic engagement tools
