# Circular Democracy - Complete Setup Guide

This guide covers setting up Supabase, Cloudflare Workers, and domain configuration for the Circular Democracy backend.

## 🗄️ Supabase Setup

### 1. Create Supabase Project

1. Go to [supabase.com](https://supabase.com) and create a new project.
2. Keep track of your **Project Ref** and **Database Password**.

### 2. Link Your Local Environment

Connect your local repository to your Supabase project. This allows you to push database migrations directly.

```bash
# Find your <project-ref> in your Supabase project's URL (e.g., https://supabase.com/dashboard/project/<project-ref>)
npx supabase link --project-ref <your-project-ref>
```

### 3. Apply Database Migrations

All the necessary tables, extensions (like `vector`), functions, and security policies are defined in the `supabase/migrations` directory. 

Run the following command to apply all these migrations to your live Supabase database:

```bash
npm run db:push
```

That's it! Your database schema is now fully configured. For any future schema changes, you should follow the migration workflow outlined in the main `README.md`.

### 4. Get Supabase Credentials

1. Go to **Settings > API** in your Supabase dashboard.
2. Copy these values. You will need them for setting secrets in the Cloudflare Worker.
   - **URL**: `https://your-project-id.supabase.co`
   - **Service Role Key**: `eyJ...` (secret key - keep secure!)

## ☁️ Cloudflare Setup

### 1. Cloudflare Account & Workers

1. Create account at [cloudflare.com](https://cloudflare.com)
2. Go to **Workers & Pages**
3. Enable Workers (free tier includes 100,000 requests/day)

### 2. Domain Setup

You have two options for domains:

#### Option A: Use Cloudflare Domains
1. Buy domains through Cloudflare:
   - `circulardemocracy.org` (main domain)
   - Or use subdomains of existing domain

#### Option B: Transfer Existing Domain
1. Transfer your domain to Cloudflare
2. Update nameservers to Cloudflare's

### 3. Configure DNS Records

In **DNS > Records**, add:

```
Type: AAAA  Name: api           Content: 100::  (Orange cloud ON)
Type: AAAA  Name: stalwart      Content: 100::  (Orange cloud ON)
Type: AAAA  Name: @             Content: 100::  (Orange cloud ON)
Type: AAAA  Name: www           Content: 100::  (Orange cloud ON)
```

The `100::` is a placeholder IPv6 - Cloudflare Workers will handle the actual routing.

## 🚀 Deploy Worker

This project is deployed as a single Cloudflare Worker. The configuration is managed by the `wrangler.toml` file in the root of the project.

### 1. Log in to Wrangler

First, authenticate the Wrangler CLI with your Cloudflare account.

```bash
npx wrangler login
```

### 2. Set Environment Secrets

The worker needs your Supabase credentials to connect to the database. These must be set as encrypted secrets in your Cloudflare account.

Run the following commands, pasting your actual Supabase URL and Service Role Key when prompted:

```bash
npx wrangler secret put SUPABASE_URL
npx wrangler secret put SUPABASE_KEY
```

### 3. Deploy

Once your secrets are set, deploy the worker using the built-in npm script:

```bash
npm run deploy
```

This command bundles and uploads the worker to your Cloudflare account. After deployment, Wrangler will display the URL where your worker is live.

## 🌐 Custom Domain Setup

### 1. Add Custom Domains in Cloudflare

1. Go to **Workers & Pages > Your Worker**
2. Click **Triggers** tab
3. Click **Add Custom Domain**
4. Add:
   - `api.circulardemocracy.org`
   - `stalwart.circulardemocracy.org`

### 2. SSL/TLS Configuration

1. Go to **SSL/TLS > Overview**
2. Set to **Full (strict)**
3. Go to **SSL/TLS > Edge Certificates**
4. Enable **Always Use HTTPS**

## 📧 Stalwart Mail Server Configuration

### 1. Install Stalwart

```bash
# Ubuntu/Debian
curl -sSL https://get.stalw.art | sh

# Or download from: https://github.com/stalwartlabs/mail-server/releases
```

### 2. Configure Stalwart

Edit `/opt/stalwart-mail/etc/config.toml`:

```toml
[server.listener."smtp"]
bind = ["0.0.0.0:25"]
protocol = "smtp"

[session.mta]
# Configure MTA hooks to call our Cloudflare Worker
[session.mta.hooks]
rcpt = "https://stalwart.circulardemocracy.org/mta-hook"
data = "https://stalwart.circulardemocracy.org/mta-hook"

[session.mta.hooks.headers]
include-headers = true
include-body = true
max-body-size = "10MB"

# JMAP configuration for fetching emails later
[jmap]
url = "https://mail.circulardemocr
