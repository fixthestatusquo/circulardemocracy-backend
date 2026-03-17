#!/usr/bin/env node

import { DatabaseClient } from "../src/database.js";
import { processMessage, PoliticianNotFoundError, type Ai, type MessageInput } from "../src/message_processor.js";
import { z } from "zod";

const MessageInputSchema = z.object({
  external_id: z
    .string()
    .min(1)
    .max(255)
    .describe("Unique identifier from source system"),
  sender_name: z
    .string()
    .min(1)
    .max(255)
    .describe("Full name of the message sender"),
  sender_email: z
    .string()
    .email()
    .max(255)
    .describe("Email address of the sender"),
  recipient_email: z
    .string()
    .email()
    .max(255)
    .describe("Email address of the target politician"),
  subject: z.string().max(500).describe("Message subject line"),
  message: z.string().min(10).max(10000).describe("Message body content"),
  html_content: z.string().max(50000).optional().describe("HTML version of message content"),
  text_content: z.string().max(50000).optional().describe("Plain text version of message content"),
  timestamp: z
    .string()
    .datetime()
    .describe("When the message was originally sent (ISO 8601)"),
  channel_source: z
    .string()
    .max(100)
    .optional()
    .describe("Source system identifier"),
  campaign_hint: z
    .string()
    .max(255)
    .optional()
    .describe("Optional campaign name hint from sender"),
  sender_flag: z.enum(["normal", "replyToDiffers", "suspicious"]).optional(),
  is_reply: z.boolean().optional(),
});

export function parseArgs(): MessageInput | null {
  const args = process.argv.slice(2);

  if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    printUsage();
    return null;
  }

  const parsed: any = {};

  for (let i = 0; i < args.length; i++) {
    const flag = args[i];

    if (!flag.startsWith('--')) {
      console.error(`Invalid argument format: ${flag}`);
      console.error('Use --help for usage information');
      process.exit(1);
    }

    const key = flag.substring(2);

    if (i + 1 < args.length && !args[i + 1].startsWith('--')) {
      parsed[key] = args[i + 1];
      i++;
    } else {
      console.error(`Missing value for argument: ${flag}`);
      console.error('Use --help for usage information');
      process.exit(1);
    }
  }

  parsed.channel_source = parsed["channel-source"] || parsed.channel_source || "cli";

  const schemaData: any = {
    external_id: parsed['message-id'],
    sender_name: parsed['sender-name'],
    sender_email: parsed['sender-email'],
    recipient_email: parsed['recipient-email'],
    subject: parsed.subject,
    message: parsed.message,
    timestamp: parsed.timestamp,
    channel_source: parsed["channel-source"] || parsed.channel_source,
    campaign_hint: parsed['campaign-name'] || parsed.campaign_hint,
  };

  try {
    return MessageInputSchema.parse(schemaData);
  } catch (error) {
    console.error('Validation error:');
    if (error instanceof z.ZodError) {
      error.errors.forEach(err => {
        console.error(`  ${err.path.join('.')}: ${err.message}`);
      });
    } else {
      console.error(error instanceof Error ? error.message : 'Unknown validation error');
    }
    process.exit(1);
  }
}

function printUsage() {
  console.log(`
Mail - Manual message import for testing

USAGE:
  mail --message-id <id> --recipient-email <email> --sender-name <name> \\
       --sender-email <email> --subject <subject> --message <message> \\
       --timestamp <iso8601> [--campaign-name <name>]

REQUIRED ARGUMENTS:
  --message-id       Unique identifier for the message
  --recipient-email  Email address of the target politician
  --sender-name      Full name of the message sender
  --sender-email     Email address of the sender
  --subject          Message subject line
  --message          Message body content (min 10 chars, max 10000 chars)
  --timestamp        When the message was originally sent (ISO 8601 format)

OPTIONAL ARGUMENTS:
  --campaign-name    Optional campaign name hint for classification
  --channel-source   Source system identifier (default: "cli")
  -h, --help         Show this help message

ENVIRONMENT VARIABLES:
  SUPABASE_URL       Required Supabase URL
  SUPABASE_KEY       Required Supabase key

EXAMPLE:
  mail --message-id "msg-123" \\
       --recipient-email "politician@example.com" \\
       --sender-name "John Doe" \\
       --sender-email "john@example.com" \\
       --subject "Support for Clean Water Initiative" \\
       --message "I strongly support the clean water initiative..." \\
       --timestamp "2024-03-15T10:30:00Z" \\
       --campaign-name "Clean Water"

TIMESTAMP FORMAT:
  Use ISO 8601 format: YYYY-MM-DDTHH:mm:ssZ or YYYY-MM-DDTHH:mm:ss.sssZ
  Example: 2024-03-15T10:30:00Z
`);
}

async function generateMockEmbedding(text: string): Promise<number[]> {
  const embedding = new Array(1024).fill(0);
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    hash = ((hash << 5) - hash) + text.charCodeAt(i);
    hash = hash & hash;
  }

  for (let i = 0; i < embedding.length; i++) {
    embedding[i] = ((hash * (i + 1)) % 1000) / 1000;
  }

  return embedding;
}

class CliAi implements Ai {
  async run(model: string, inputs: any): Promise<any> {
    if (model === "@cf/baai/bge-m3" && inputs.text) {
      const embedding = await generateMockEmbedding(inputs.text);
      return { data: [embedding] };
    }
    throw new Error(`Unsupported model or inputs: ${model}`);
  }
}

async function main() {
  const messageInput = parseArgs();
  if (!messageInput) {
    return;
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    console.error('Error: SUPABASE_URL and SUPABASE_KEY environment variables must be set');
    process.exit(1);
  }

  try {
    const db = new DatabaseClient({ url: supabaseUrl, key: supabaseKey });
    const ai: Ai = new CliAi();

    console.log('Processing message...');

    const result = await processMessage(db, ai, messageInput);

    console.log('\n=== Message Processing Result ===');
    console.log(`Success: ${result.success}`);
    console.log(`Status: ${result.status}`);

    if (result.message_id) {
      console.log(`Message ID: ${result.message_id}`);
    }

    if (result.campaign_id) {
      console.log(`Campaign ID: ${result.campaign_id}`);
    }

    if (result.campaign_name) {
      console.log(`Campaign Name: ${result.campaign_name}`);
    }

    if (result.confidence !== undefined) {
      console.log(`Confidence: ${(result.confidence * 100).toFixed(1)}%`);
    }

    if (result.duplicate_rank !== undefined) {
      console.log(`Duplicate Rank: ${result.duplicate_rank}`);
    }

    if (result.errors && result.errors.length > 0) {
      console.log('\nErrors:');
      result.errors.forEach(error => {
        console.log(`  - ${error}`);
      });
    }

    process.exit(result.success ? 0 : 1);

  } catch (error) {
    console.error('\nError processing message:');

    if (error instanceof PoliticianNotFoundError) {
      console.error(`Politician not found: ${error.message}`);
    } else if (error instanceof Error) {
      console.error(error.message);
    } else {
      console.error('Unknown error occurred');
    }

    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}
