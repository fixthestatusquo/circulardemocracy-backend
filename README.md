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
1. **Input Channels** → REST API or Email (Stalwart webhook)
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

### Analytics API
- Campaign overview statistics
- Active campaign metrics (7-day windows)
- Email volume by day/campaign
- Bounce and delivery tracking

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

-   `npm run db:start`
    -   **What it does:** Starts the local Supabase Docker containers.
    -   **When to use it:** At the beginning of every development session.

-   `npm run db:reset`
    -   **What it does:** Stops the local database, destroys all data, and restarts it by re-applying all migration files from scratch.
    -   **When to use it:** When you need a clean slate or want to test the entire migration process.

-   `npm run db:diff -- <migration_name>`
    -   **What it does:** Compares the current state of your local database with the last migration file and generates a *new* migration file containing the differences.
    -   **When to use it:** After you have made schema changes to your local database (e.g., using a GUI tool or `psql`) and want to commit those changes to a new migration file.
    -   **Example:** `npm run db:diff -- add_user_profiles`

-   `npm run db:push`
    -   **What it does:** Applies any new, un-applied migration files to your remote (production) Supabase database.
    -   **When to use it:** When you are ready to deploy your schema changes to production. You must first link your project with `supabase link --project-ref <your-project-ref>`.

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


