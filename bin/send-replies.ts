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
  processScheduledReplies,
  type ProcessingResult,
} from "../src/reply_worker.js";

dotenv();

/** Must match `MAX_RETRY_ATTEMPTS` in `src/reply_worker.ts`. */
const MAX_RETRY_ATTEMPTS = 10;

export function parseArgs(args: string[]): CliFilters | null {
  const argv = minimist(args, {
    string: ["campaign-name", "politician-name"],
    boolean: ["dry-run", "help"],
    alias: { h: "help" },
  });

  if (argv.help) {
    return null;
  }

  const campaignId = argv["campaign-id"];
  const campaignName = argv["campaign-name"];
  const politicianId = argv["politician-id"];
  const politicianName = argv["politician-name"];

  if (campaignId !== undefined && campaignName !== undefined) {
    console.error("Use only one of --campaign-id or --campaign-name");
    process.exit(1);
  }

  if (politicianId !== undefined && politicianName !== undefined) {
    console.error("Use only one of --politician-id or --politician-name");
    process.exit(1);
  }

  return {
    campaignId: typeof campaignId === "number" ? campaignId : undefined,
    campaignName: typeof campaignName === "string" ? campaignName : undefined,
    politicianId: typeof politicianId === "number" ? politicianId : undefined,
    politicianName:
      typeof politicianName === "string" ? politicianName : undefined,
    dryRun: argv["dry-run"] === true,
  };
}

async function processFilteredReplies(
  db: DatabaseClient,
  options: CliFilters,
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
  options: CliFilters,
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
