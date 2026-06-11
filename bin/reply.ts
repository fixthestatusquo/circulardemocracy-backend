#!/usr/bin/env -S ./node_modules/.bin/tsx

import { config as dotenv } from "dotenv";
import type { DatabaseClient } from "../src/database.js";
import { DatabaseClient as DatabaseClientImpl } from "../src/database.js";
import minimist from "minimist";
import {
  resolveCampaignId,
  resolvePoliticianId,
  type CliFilters,
} from "../src/cli_shared.js";
import {
  sendScheduledReplies,
replyMessage,
  type ProcessingResult,
} from "../src/reply_worker.js";

dotenv({ quiet: true });

/** Must match `MAX_RETRY_ATTEMPTS` in `src/reply_worker.ts`. @todo import from there*/
const MAX_RETRY_ATTEMPTS = 10;

export function parseArgs(args: string[]): CliFilters  {
  const argv = minimist(args, {
    string: ["campaign-name", "politician-name", "campaign-id","politician-id","limit","politician-name","message"],
    boolean: ["dry-run", "help", "desc"],
    alias: { h: "help" },
    unknown: (d: string) => {
      if (d[0] !== "-" ) return true;
      console.error(`Unknown option: ${d}`);
      process.exit(1);
      return false;
    },
  });

  if (argv.help) {
    printUsage();
    process.exit(1);
  }

  const campaignId = argv["campaign-id"];
  const campaignName = argv["campaign-name"];
  const politicianId = Number(argv["politician-id"]) || undefined;
  const politicianName = argv["politician-name"];
  if (campaignId !== undefined && campaignName !== undefined) {
    console.error("Use only one of --campaign-id or --campaign-name");
    process.exit(1);
  }

  if (politicianId !== undefined && politicianName !== undefined) {
    console.error("Use only one of --politician-id or --politician-name");
    process.exit(1);
  }

  if (argv.limit !== undefined && politicianId === undefined) {
    console.error("--limit requires --politician-id");
    process.exit(1);
  }

  return {
    campaignId: typeof campaignId === "number" ? campaignId : undefined,
    campaignName: typeof campaignName === "string" ? campaignName : undefined,
    politicianId: typeof politicianId === "number" ? politicianId : undefined,
    politicianName:
      typeof politicianName === "string" ? politicianName : undefined,
    dryRun: argv["dry-run"] === true,
    desc: argv.desc === true,
    limit: Number(argv.limit) || undefined,
    messageId: argv.message,
  };
}

async function sendFilteredReplies(
  db: DatabaseClient,
  options: CliFilters,
): Promise<ProcessingResult> {
  // If --message is given without --politician-id, resolve the politician from the message
  if (options.messageId !== undefined && options.politicianId === undefined) {
    const msg = await db.getMessageByExternalIdBare(options.messageId, "stalwart");
    if (!msg) {
      throw new Error(`Message ${options.messageId} not found`);
    }
    options.politicianId = msg.politician_id;
  }

  if (options.messageId !== undefined && options.politicianId !== undefined) {
    console.log(`Processing specific message: ${options.messageId} for ${options.politicianId}`);
    return replyMessage(db, 
      options.messageId, options.politicianId);
  }

  const campaignId = await resolveCampaignId(db, options);
  const politicianId = await resolvePoliticianId(db, options);

  console.log("Processing replies with filters:", {
    campaignId,
    politicianId,
    limit: options.limit,
  });

  return sendScheduledReplies(db, {
    campaignId,
    politicianId,
    limit: options.limit,
    desc: options.desc,
  });
}

export async function previewReadyReplies(
  db: DatabaseClient,
  options: CliFilters,
): Promise<void> {
  let allReady: any[] = [];
  if (options.messageId !== undefined) {
    // If --message is given without --politician-id, resolve from the message
    if (!options.politicianId) {
      const msg = await db.getMessageByExternalIdBare(options.messageId, "stalwart");
      if (msg) {
        options.politicianId = msg.politician_id;
      }
    }
    const politicianId = await resolvePoliticianId(db, options);
    const msg = await db.getMessageByExternalId(
      options.messageId, 
      "stalwart", 
      options.politicianId || -1,
    );
    allReady = msg ? [msg] : [];
  } else {
    const campaignId = await resolveCampaignId(db, options);
    const politicianId = await resolvePoliticianId(db, options);

    allReady = await db.getMessagesReadyToSend(MAX_RETRY_ATTEMPTS, {
      campaignId,
      politicianId,
      limit: options.limit,
      desc: options.desc,
    });
  }

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
  console.log(allReady.map(m => `${m.external_id} ${m.received_at}`));
}

function printUsage() {
  console.log(`
Reply - Send outbound auto-replies using the production reply worker

USAGE:
  reply
  reply [--campaign-id <id> | --campaign-name <hint>]
  reply [--politician-id <id> | --politician-name <hint>] [--limit <n>]
  reply [--message <id>]

OPTIONS:
  --campaign-id <id>      Filter by campaign (numeric id)
  --campaign-name <hint>  Filter by campaign (name/slug ilike match)
  --politician-id <id>    Filter by politician (numeric id)
  --politician-name <hint> Filter by politician (email exact or partial)
  --limit <n>             Limit the number of emails processed (requires --politician-id)
  --message <id>          Process only this specific message ID
  --desc                  Process newest messages first (default: oldest first)
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

  try {
    const db = new DatabaseClientImpl({ url: supabaseUrl, key: supabaseKey });
    if (options.dryRun) {
      await previewReadyReplies(db, options);
      return;
    }

    const result = await sendFilteredReplies(db, options);

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
