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
  campaignId?: number;
  campaignName?: string;
  politicianId?: number;
  politicianName?: string;
  dryRun?: boolean;
}

export function parseArgs(args: string[]): SendRepliesOptions | null {
  if (args.includes("--help") || args.includes("-h")) {
    return null;
  }

  const parsed: Record<string, string | number | boolean> = {};
  const booleanFlags = new Set(["dry-run"]);

  for (let i = 0; i < args.length; i++) {
    const flag = args[i];

    if (!flag.startsWith("--")) {
      console.error(`Invalid argument format: ${flag}`);
      console.error("Use --help for usage information");
      process.exit(1);
    }

    const key = flag.substring(2);

    if (booleanFlags.has(key)) {
      parsed[key] = true;
      continue;
    }

    if (i + 1 < args.length && !args[i + 1].startsWith("--")) {
      const value = args[i + 1];

      if (key === "campaign-id" || key === "politician-id") {
        const numValue = parseInt(value, 10);
        if (Number.isNaN(numValue)) {
          console.error(`Invalid ${key} value: ${value}`);
          process.exit(1);
        }
        parsed[key] = numValue;
      } else if (key === "campaign-name" || key === "politician-name") {
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

  if (
    parsed["politician-id"] !== undefined &&
    parsed["politician-name"] !== undefined
  ) {
    console.error("Use only one of --politician-id or --politician-name");
    process.exit(1);
  }

  return {
    campaignId:
      typeof parsed["campaign-id"] === "number"
        ? parsed["campaign-id"]
        : undefined,
    campaignName:
      typeof parsed["campaign-name"] === "string"
        ? parsed["campaign-name"]
        : undefined,
    politicianId:
      typeof parsed["politician-id"] === "number"
        ? parsed["politician-id"]
        : undefined,
    politicianName:
      typeof parsed["politician-name"] === "string"
        ? parsed["politician-name"]
        : undefined,
    dryRun: parsed["dry-run"] === true,
  };
}

export async function resolveCampaignId(
  db: DatabaseClient,
  options: Pick<SendRepliesOptions, "campaignId" | "campaignName">,
): Promise<number | undefined> {
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

  return undefined;
}

export async function resolvePoliticianId(
  db: DatabaseClient,
  options: Pick<SendRepliesOptions, "politicianId" | "politicianName">,
): Promise<number | undefined> {
  if (options.politicianId !== undefined) {
    const politician = await db.getPoliticianById(options.politicianId);
    if (!politician) {
      throw new Error(`Politician not found: id ${options.politicianId}`);
    }
    return politician.id;
  }

  if (options.politicianName) {
    const politician = await db.findPoliticianByEmail(options.politicianName);
    if (!politician) {
      throw new Error(
        `No politician matched name/email hint: ${options.politicianName}`,
      );
    }
    return politician.id;
  }

  return undefined;
}

async function processFilteredReplies(
  db: DatabaseClient,
  options: SendRepliesOptions,
  runtimeSecrets: Record<string, string | undefined>,
): Promise<ProcessingResult> {
  const campaignId = await resolveCampaignId(db, options);
  const politicianId = await resolvePoliticianId(db, options);

  console.log("Processing replies with filters:", { campaignId, politicianId });

  return processScheduledReplies(db, runtimeSecrets, {
    campaignId,
    politicianId,
  });
}

export async function previewReadyReplies(
  db: DatabaseClient,
  options: SendRepliesOptions,
): Promise<void> {
  const campaignId = await resolveCampaignId(db, options);
  const politicianId = await resolvePoliticianId(db, options);

  const allReady = await db.getMessagesReadyToSend(MAX_RETRY_ATTEMPTS, {
    campaignId,
    politicianId,
  });

  console.log("DRY RUN - No replies will be sent.\n");

  if (allReady.length === 0) {
    console.log("  (none)");
    console.log("\nTotal: 0 message(s) ready to send");
    return;
  }

  const byCampaign = new Map<number, typeof allReady>();
  for (const message of allReady) {
    const list = byCampaign.get(message.campaign_id) ?? [];
    list.push(message);
    byCampaign.set(message.campaign_id, list);
  }

  console.log("Replies that would be sent per campaign:\n");

  const campaignIds = [...byCampaign.keys()].sort((a, b) => a - b);
  for (const cid of campaignIds) {
    const messages = byCampaign.get(cid)!;
    const campaign = await db.getCampaignById(cid);
    console.log(
      `  ${campaign?.name ?? cid} (id ${cid}): ${messages.length}`,
    );
  }

  console.log(
    `\nTotal: ${allReady.length} message(s) ready to send across ${byCampaign.size} campaign(s)`,
  );
}

function printUsage() {
  console.log(`
Send Replies - Test outbound auto-replies using the production reply worker

USAGE:
  send-replies
  send-replies [--campaign-id <id> | --campaign-name <hint>]
  send-replies [--politician-id <id> | --politician-name <hint>]

OPTIONS:
  --campaign-id <id>      Filter by campaign (numeric id)
  --campaign-name <hint>  Filter by campaign (name/slug ilike match)
  --politician-id <id>    Filter by politician (numeric id)
  --politician-name <hint> Filter by politician (email exact or partial)
  --dry-run               Preview what would be sent without sending mail
  -h, --help              Show this help message

Without filters, processes all messages ready to send (same as the scheduled worker).
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

  try {
    const db = new DatabaseClientImpl({ url: supabaseUrl, key: supabaseKey });
    const runtimeSecrets = process.env as Record<string, string | undefined>;

    if (options.dryRun) {
      await previewReadyReplies(db, options);
      return;
    }

    const result = await processFilteredReplies(db, options, runtimeSecrets);
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
