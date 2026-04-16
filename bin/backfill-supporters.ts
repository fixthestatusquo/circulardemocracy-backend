#!/usr/bin/env node

import "dotenv/config";
import { createClient } from "@supabase/supabase-js";

type MessageRow = {
  id: number;
  campaign_id: number | null;
  politician_id: number;
  sender_hash: string;
  received_at: string;
};

type SupporterAggregate = {
  campaign_id: number;
  politician_id: number;
  sender_hash: string;
  first_message_at: string;
  last_message_at: string;
  message_count: number;
};

function parseArgs() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  return { dryRun };
}

function mergeSupporter(
  current: SupporterAggregate | undefined,
  nextMessage: MessageRow,
): SupporterAggregate {
  if (!current) {
    return {
      campaign_id: nextMessage.campaign_id as number,
      politician_id: nextMessage.politician_id,
      sender_hash: nextMessage.sender_hash,
      first_message_at: nextMessage.received_at,
      last_message_at: nextMessage.received_at,
      message_count: 1,
    };
  }

  return {
    ...current,
    first_message_at:
      new Date(nextMessage.received_at) < new Date(current.first_message_at)
        ? nextMessage.received_at
        : current.first_message_at,
    last_message_at:
      new Date(nextMessage.received_at) > new Date(current.last_message_at)
        ? nextMessage.received_at
        : current.last_message_at,
    message_count: current.message_count + 1,
  };
}

async function main() {
  const { dryRun } = parseArgs();
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    throw new Error("SUPABASE_URL and SUPABASE_KEY must be set in environment");
  }

  const supabase = createClient(supabaseUrl, supabaseKey, {
    auth: { persistSession: false },
    global: { fetch: (...args) => fetch(...args) },
  });

  // Read message metadata (no message content / no new PII handling here).
  const { data: messages, error: messagesError } = await supabase
    .from("messages")
    .select("id,campaign_id,politician_id,sender_hash,received_at")
    .not("campaign_id", "is", null);

  if (messagesError) {
    throw messagesError;
  }

  const messageRows = (messages || []) as MessageRow[];
  if (messageRows.length === 0) {
    console.log("No messages found. Nothing to backfill.");
    return;
  }

  const supportersMap = new Map<string, SupporterAggregate>();
  for (const message of messageRows) {
    if (!message.campaign_id) {
      continue;
    }

    const key = `${message.campaign_id}:${message.politician_id}:${message.sender_hash}`;
    supportersMap.set(
      key,
      mergeSupporter(supportersMap.get(key), message),
    );
  }

  const supporters = Array.from(supportersMap.values());
  if (supporters.length === 0) {
    console.log(
      "No eligible supporter rows found from messages + sender_emails join.",
    );
    return;
  }

  console.log(
    `Prepared ${supporters.length} supporter records from ${messageRows.length} messages.`,
  );

  if (dryRun) {
    console.log("Dry run complete. No changes written.");
    return;
  }

  const { data: upsertData, error: upsertError, status: upsertStatus } =
    await supabase.from("supporters").upsert(
    supporters.map((s) => ({
      campaign_id: s.campaign_id,
      politician_id: s.politician_id,
      sender_hash: s.sender_hash,
      first_message_at: s.first_message_at,
      last_message_at: s.last_message_at,
      message_count: s.message_count,
      updated_at: new Date().toISOString(),
    })),
    { onConflict: "campaign_id,politician_id,sender_hash" },
  );

  if (upsertError) {
    console.error("Upsert status:", upsertStatus);
    console.error("Upsert error payload:", upsertError);
    throw upsertError;
  }

  console.log(
    `Backfill successful. Upserted ${supporters.length} supporter records.`,
  );
  if (upsertData) {
    console.log("Upsert returned rows:", upsertData.length);
  }
}

main().catch((error) => {
  if (error instanceof Error) {
    console.error("Backfill failed:", error.message);
  } else {
    try {
      console.error("Backfill failed:", JSON.stringify(error, null, 2));
    } catch {
      console.error("Backfill failed:", error);
    }
  }
  process.exit(1);
});

