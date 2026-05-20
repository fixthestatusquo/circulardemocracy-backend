#!/usr/bin/env node

import { config as dotenv } from "dotenv";
import type { DatabaseClient } from "../src/database.js";
import { DatabaseClient as DatabaseClientImpl } from "../src/database.js";
import {
  processReplyImmediately,
  processScheduledReplies,
  type ProcessingResult,
} from "../src/reply_worker.js";

dotenv();

/** Must match `MAX_RETRY_ATTEMPTS` in `src/reply_worker.ts`. */
const MAX_RETRY_ATTEMPTS = 10;

export interface SendRepliesOptions {
  messageId?: number;
  campaignId?: number;
  campaignName?: string;
}

export function parseArgs(args: string[]): SendRepliesOptions | null {
  if (args.includes("--help") || args.includes("-h")) {
    return null;
  }

  const parsed: Record<string, string | number> = {};

  for (let i = 0; i < args.length; i++) {
    const flag = args[i];

    if (!flag.startsWith("--")) {
      console.error(`Invalid argument format: ${flag}`);
      console.error("Use --help for usage information");
      process.exit(1);
    }

    const key = flag.substring(2);

    if (i + 1 < args.length && !args[i + 1].startsWith("--")) {
      const value = args[i + 1];

      if (key === "message-id" || key === "campaign-id") {
        const numValue = parseInt(value, 10);
        if (Number.isNaN(numValue)) {
          console.error(`Invalid ${key} value: ${value}`);
          process.exit(1);
        }
        parsed[key] = numValue;
      } else if (key === "campaign-name") {
        parsed[key] = value;
      } else {
        console.error(`Unknown option: --${key}`);
        console.error("Use --help for usage information");
        process.exit(1);
      }

      i++;
      continue;
    }

    console.error(`Missing value for argument: ${flag}`);
    console.error("Use --help for usage information");
    process.exit(1);
  }

  if (
    parsed["campaign-id"] !== undefined &&
    parsed["campaign-name"] !== undefined
  ) {
    console.error("Use only one of --campaign-id or --campaign-name");
    process.exit(1);
  }

  return {
    messageId:
      typeof parsed["message-id"] === "number" ? parsed["message-id"] : undefined,
    campaignId:
      typeof parsed["campaign-id"] === "number"
        ? parsed["campaign-id"]
        : undefined,
    campaignName:
      typeof parsed["campaign-name"] === "string"
        ? parsed["campaign-name"]
        : undefined,
  };
}

export async function resolveCampaignId(
  db: DatabaseClient,
  options: Pick<SendRepliesOptions, "campaignId" | "campaignName">,
): Promise<number> {
  if (options.campaignId !== undefined) {
    const campaign = await db.getCampaignById(options.campaignId);
    if (!campaign) {
      throw new Error(`Campaign not found: id ${options.campaignId}`);
    }
    return campaign.id;
  }

  if (options.campaignName) {
    const campaign = await db.findCampaignByHint(options.campaignName);
    if (!campaign) {
      throw new Error(
        `No campaign matched name hint: ${options.campaignName}`,
      );
    }
    return campaign.id;
  }

  throw new Error("Campaign id or name is required");
}

async function processCampaignReplies(
  db: DatabaseClient,
  campaignId: number,
  runtimeSecrets: Record<string, string | undefined>,
): Promise<ProcessingResult> {
  const result: ProcessingResult = {
    total: 0,
    sent: 0,
    failed: 0,
    errors: [],
  };

  const allReady = await db.getMessagesReadyToSend(MAX_RETRY_ATTEMPTS);
  const messages = allReady.filter((m) => m.campaign_id === campaignId);
  result.total = messages.length;

  console.log(
    `Found ${messages.length} message(s) ready to send for campaign ${campaignId}`,
  );

  for (const message of messages) {
    try {
      await processReplyImmediately(db, message.id, runtimeSecrets);
      result.sent++;
      console.log(`[Reply Worker] ✓ Sent reply for message ${message.id}`);
    } catch (error) {
      result.failed++;
      const errorMsg =
        error instanceof Error ? error.message : "Unknown error";
      result.errors.push({ message_id: message.id, error: errorMsg });
      console.error(
        `[Reply Worker] ✗ Failed to send reply for message ${message.id}:`,
        errorMsg,
      );
    }
  }

  return result;
}

function printUsage() {
  console.log(`
Send Replies - Test outbound auto-replies using the production reply worker

USAGE:
  send-replies [--message-id <id>]
  send-replies [--campaign-id <id> | --campaign-name <hint>]

OPTIONS:
  --message-id <id>       Send reply for one message row (pending/scheduled, not yet sent)
  --campaign-id <id>      Send all ready replies for a campaign (numeric id)
  --campaign-name <hint>  Send all ready replies for a campaign (name/slug ilike match)
  -h, --help              Show this help message

Without filters, processes all messages ready to send (same as the scheduled worker).

ENVIRONMENT VARIABLES:
  SUPABASE_URL                    Required
  SUPABASE_KEY                    Required
  JMAP_URL                        Required (mail server base URL)
  SUPABASE_ANON_KEY               Required when ALL_DOMAIN is unset (Supabase relay JWT)
  RELAY_SERVICE_ACCOUNT_EMAIL     Required
  RELAY_SERVICE_ACCOUNT_PASSWORD  Required

Impersonation (Stalwart Basic auth, same as reply worker):
  ALL_DOMAIN                      When set (e.g. example.org), sends via target%RELAY_SERVICE_ACCOUNT_EMAIL
  RELAY_SERVICE_ACCOUNT_EMAIL     Impersonator account
  RELAY_SERVICE_ACCOUNT_PASSWORD  Impersonator password

EXAMPLES:
  send-replies
  send-replies --message-id 42
  send-replies --campaign-id 5
  send-replies --campaign-name "Climate Action"
`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.includes("--help") || args.includes("-h")) {
    printUsage();
    return;
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    console.error(
      "Error: SUPABASE_URL and SUPABASE_KEY environment variables must be set",
    );
    process.exit(1);
  }

  const options = parseArgs(args);
  if (!options) {
    return;
  }

  if (
    options.messageId !== undefined &&
    (options.campaignId !== undefined || options.campaignName !== undefined)
  ) {
    console.error("Use only one of --message-id or --campaign-id/--campaign-name");
    process.exit(1);
  }

  try {
    const db = new DatabaseClientImpl({ url: supabaseUrl, key: supabaseKey });
    const runtimeSecrets = process.env as Record<string, string | undefined>;

    if (options.messageId !== undefined) {
      console.log(`Sending reply for message ${options.messageId}...`);
      await processReplyImmediately(db, options.messageId, runtimeSecrets);
      console.log(`Reply sent for message ${options.messageId}.`);
      return;
    }

    if (options.campaignId !== undefined || options.campaignName) {
      const campaignId = await resolveCampaignId(db, options);
      const campaign = await db.getCampaignById(campaignId);
      console.log(
        `Processing replies for campaign: ${campaign?.name ?? campaignId} (id ${campaignId})`,
      );
      const result = await processCampaignReplies(
        db,
        campaignId,
        runtimeSecrets,
      );
      console.log(JSON.stringify(result, null, 2));
      if (result.failed > 0) {
        process.exit(1);
      }
      return;
    }

    console.log("Processing scheduled replies...");
    const result = await processScheduledReplies(db, runtimeSecrets);
    console.log(JSON.stringify(result, null, 2));

    if (result.failed > 0) {
      process.exit(1);
    }
  } catch (error) {
    console.error("\nError sending replies:");

    if (error instanceof Error) {
      console.error(error.message);
    } else {
      console.error("Unknown error occurred");
    }

    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error("Fatal error:", error);
    process.exit(1);
  });
}
