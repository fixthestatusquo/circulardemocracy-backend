# Circular Democracy Backend

A democratic engagement platform that enables citizens to communicate directly with their elected representatives and facilitates meaningful two-way dialogue between constituents and politicians.

## Overview

Circular Democracy is designed to bridge the communication gap between citizens and their elected representatives by providing a structured system for message routing, classification, and response management. The platform processes citizen messages through multiple channels, intelligently categorizes them by campaign/topic, and enables politicians to send personalized replies to their constituents.

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

### Prerequisites
- Supabase account and project
- Cloudflare Workers AI access
- Stalwart mail server (for email channel)
- RabbitMQ instance (for message queuing)

### Installation
```bash
# Clone the repository
git clone https://github.com/fixthestatusquo/circulardemocracy-backend.git
cd circulardemocracy-backend

# Install dependencies
npm install

# Configure environment variables
cp .env.example .env
# Edit .env with your Supabase, Cloudflare, and other credentials

# Run database migrations
npm run migrate

# Start the development server
npm run dev
```

### Configuration
1. **Supabase Setup**: Configure database with vector storage for BGE-M3 embeddings
2. **Cloudflare Workers AI**: Set up BGE-M3 model access for message classification
3. **Stalwart Integration**: Configure MTA hooks for email processing
4. **Authentication**: Set up politician accounts and access controls

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



# Email Classification

Many citizens write to their elected representatives as part of campaigns organised by NGOs. This will be a mix of pre-written messages (copypasta activism) and more personal and customised onces that are part of a campaign (these two are the bulk of the email received) and some edge cases of someone using the campaign but writting on a different topic.

In order to be able let the politicians understand the size of each campaign and their volume of activity at any given time, and to be able to reply automatically (at least when that's the same pre-written messages), we first need to classify these emails

For privacy reasons, we are trying to minimise the personal information of each supporter to the strict minimum possible. For instance, the AI model used to classify a message won't use the name or email of the supporter to be able to decide what is the campaign (if any) that enpowered the supporter to write, so it shouldn't have access to these data. 

For performance reasons, it should be noted that it's quite common that the same supporter will send almost identical emails (may be with the first line "Dear representative Smith", "Dear representative Doe" being different), and in principle, there is no need classify each of them, or at least avoid overfitting the model because of these duplicates.


## Overview

As MVP, we are focussing on being able to classify a message.  For the MVP, we are going to leverage external services:

1.    Cloudflare Workers (REST API receiving the message to classify)
2.    Cloudflare AI (embedding)
3.    Supabase (PostgreSQL + pgvector for storage/similarity search)


# This is WIP to be fleshed out


# cloudflare worker

input (at minima)
- message id
- sender identifier (hash of the email?)
- timestamp
- subject
- body (either html or text)


returns

if part of a known campaign:
. campaign_name
- confidence/similarity (how likely that email belong to that campaign?)
- language?

Language might be a parameter? in the European parliament, the representatives can speak at least 24 official languages an multiple others. The citizens are usually writing to them in the language of their country or english. It would be better that if I write to my french MEP in english, they reply to me in english, not in french. #possibleV1


if unknown:
- some kind of automatically generated "virtual campaign name?"

Note: how to handle the unknown is not clear to be, should we use LLMs if we can't find an existing campaign that matches the email?)


Cloudflare provide you several 


    Cloudflare Account

        Workers + AI enabled.

    Supabase Project

        PostgreSQL with pgvector extension.

    Reference Data

        Pre-labeled email examples (to train the system).

Setup
1. Supabase Configuration

    Enable pgvector extension in your database.

    Create tables:

        categories (predefined labels).

        email_embeddings (stores text + vector embeddings).

    Configure Row-Level Security (RLS) if needed.

2. Cloudflare Worker

    Bind Cloudflare AI and Supabase environment variables.

    Deploy the worker to handle HTTP requests.

3. Cloudflare AI

    Use the @cf/baai/bge-base-en-v1.5 embedding model (no setup required).

Workflow

    Preload Reference Emails

        Generate embeddings for labeled examples and store in Supabase.

    Classify New Emails

        Submit email text → Worker fetches embedding → Supabase finds closest category.

Performance

    Latency: ~100-300ms (varies with email length).

    Accuracy: Improves with more labeled examples.

Limitations

    Cold starts in Cloudflare Workers (rare for frequent requests).

    Euclidean/cosine distance trade-offs (test for your use case).

Next Steps

    Add examples to the reference dataset.

    Configure email triggers (e.g., MailChannels or SMTP).
