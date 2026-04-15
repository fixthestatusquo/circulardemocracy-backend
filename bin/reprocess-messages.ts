#!/usr/bin/env bun

import { DatabaseClient } from "../src/database.js";
import { generateEmbedding, formatEmailContentForEmbedding } from "../src/embedding_service.js";
import { z } from "zod";
import Turndown from "turndown";
import {config as dotenv} from "dotenv";
dotenv();

interface ReprocessOptions {
  campaignId?: number;
  since?: string;
  limit?: number;
  processAll: boolean;
  dryRun: boolean;
  moveToFolders: boolean;
  username?: string;
  password?: string;
}

interface Ai {
  run(model: string, inputs: any): Promise<any>;
}

interface JmapSessionResponse {
  apiUrl: string;
  primaryAccounts?: Record<string, string>;
  accounts?: Record<string, unknown>;
}

interface JmapBodyPart {
  partId?: string;
}

interface JmapBodyValue {
  value?: string;
}

interface JmapEmail {
  id: string;
  subject?: string;
  textBody?: JmapBodyPart[];
  htmlBody?: JmapBodyPart[];
  bodyValues?: Record<string, JmapBodyValue>;
}

const STALWART_JMAP_ENDPOINT = "https://mail.circulardemocracy.org/.well-known/jmap";
const turndownService = new Turndown({
  headingStyle: "atx",
  bulletListMarker: "-",
  codeBlockStyle: "fenced",
  fence: "```",
  emDelimiter: "*",
  strongDelimiter: "**",
  linkStyle: "inlined",
});


function encodeBasicAuth(username: string, password: string): string {
  return `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`;
}

async function fetchJmapSession(
  endpoint: string,
  authHeader: string,
): Promise<JmapSessionResponse> {
  const response = await fetch(endpoint, {
    method: "GET",
    headers: {
      Authorization: authHeader,
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `Failed to connect to JMAP endpoint (${response.status}): ${body || "No response body"}`,
    );
  }

  return (await response.json()) as JmapSessionResponse;
}

async function jmapCall(
  apiUrl: string,
  authHeader: string,
  methodCalls: unknown[],
): Promise<any[][]> {
  const response = await fetch(apiUrl, {
    method: "POST",
    headers: {
      Authorization: authHeader,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      using: ["urn:ietf:params:jmap:core", "urn:ietf:params:jmap:mail"],
      methodCalls,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `JMAP API request failed (${response.status}): ${body || "No response body"}`,
    );
  }

  const json = await response.json() as { methodResponses?: any[][] };
  if (!json.methodResponses) {
    throw new Error("Invalid JMAP response: missing methodResponses");
  }

  return json.methodResponses;
}

function getMethodResponse(
  methodResponses: any[][],
  methodName: string,
  callId: string,
): any {
  const response = methodResponses.find(
    (entry) => entry[0] === methodName && entry[2] === callId,
  );

  if (!response) {
    throw new Error(`JMAP response missing ${methodName} for callId=${callId}`);
  }

  return response[1];
}

function resolveAccountId(session: JmapSessionResponse): string {
  const primaryMailAccount =
    session.primaryAccounts?.["urn:ietf:params:jmap:mail"];
  if (primaryMailAccount) {
    return primaryMailAccount;
  }

  const accountId = Object.keys(session.accounts || {})[0];
  if (accountId) {
    return accountId;
  }

  throw new Error("No JMAP mail account found in session response");
}

async function fetchEmailById(
  apiUrl: string,
  authHeader: string,
  accountId: string,
  messageId: string,
): Promise<JmapEmail | null> {
  const directGetResponses = await jmapCall(apiUrl, authHeader, [
    [
      "Email/get",
      {
        accountId,
        ids: [messageId],
        properties: [
          "id",
          "subject",
          "textBody",
          "htmlBody",
          "bodyValues",
        ],
        fetchTextBodyValues: true,
        fetchHTMLBodyValues: true,
      },
      "getById",
    ],
  ]);

  const directGet = getMethodResponse(
    directGetResponses,
    "Email/get",
    "getById",
  );

  if (Array.isArray(directGet.list) && directGet.list.length > 0) {
    return directGet.list[0] as JmapEmail;
  }

  return null;
}

function extractBodyFromParts(
  parts: JmapBodyPart[] | undefined,
  bodyValues: Record<string, JmapBodyValue> | undefined,
): string {
  if (!parts || !bodyValues) {
    return "";
  }

  return parts
    .map((part) => part.partId)
    .filter((partId): partId is string => typeof partId === "string")
    .map((partId) => bodyValues[partId]?.value?.trim() || "")
    .filter((value) => value.length > 0)
    .join("\n\n");
}

function generateFolderPath(campaignName: string | null): string {
  if (!campaignName) {
    return "Unclassified";
  }

  const campaignFolder = campaignName
    .replace(/[^a-zA-Z0-9\-_\s]/g, "")
    .replace(/\s+/g, "-")
    .substring(0, 50);

  return campaignFolder;
}

async function ensureMailboxExists(
  apiUrl: string,
  authHeader: string,
  accountId: string,
  folderName: string,
): Promise<string> {
  // Check if mailbox already exists
  const queryResponses = await jmapCall(apiUrl, authHeader, [
    [
      "Mailbox/query",
      {
        accountId,
        filter: {
          name: folderName,
        },
      },
      "queryMailbox",
    ],
    [
      "Mailbox/get",
      {
        accountId,
        "#ids": {
          resultOf: "queryMailbox",
          name: "Mailbox/query",
          path: "/ids",
        },
      },
      "getMailbox",
    ],
  ]);

  const getData = getMethodResponse(queryResponses, "Mailbox/get", "getMailbox");

  if (Array.isArray(getData.list) && getData.list.length > 0) {
    return getData.list[0].id;
  }

  // Create new mailbox if it doesn't exist
  const createResponses = await jmapCall(apiUrl, authHeader, [
    [
      "Mailbox/set",
      {
        accountId,
        create: {
          newMailbox: {
            name: folderName,
          },
        },
      },
      "createMailbox",
    ],
  ]);

  const setData = getMethodResponse(createResponses, "Mailbox/set", "createMailbox");
  if (setData.created?.newMailbox?.id) {
    return setData.created.newMailbox.id;
  } else {
    throw new Error(`Failed to create mailbox: ${folderName}`);
  }
}

async function moveEmailToMailbox(
  apiUrl: string,
  authHeader: string,
  accountId: string,
  emailId: string,
  targetMailboxId: string,
): Promise<void> {
  await jmapCall(apiUrl, authHeader, [
    [
      "Email/set",
      {
        accountId,
        update: {
          [emailId]: {
            mailboxIds: {
              [targetMailboxId]: true,
            },
          },
        },
      },
      "moveEmail",
    ],
  ]);
}

function parseArgs(args: string[]): ReprocessOptions {
  const parsed: Record<string, string | boolean | number> = {};
  const booleanFlags = new Set(["dry-run", "process-all", "move-to-folders", "no-move-to-folders"]);

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

      // Try to parse as number for campaign-id and limit
      if (key === "campaign-id" || key === "limit") {
        const numValue = parseInt(value, 10);
        if (isNaN(numValue)) {
          console.error(`Invalid ${key} value: ${value}`);
          process.exit(1);
        }
        parsed[key] = numValue;
      } else {
        parsed[key] = value;
      }

      i++;
      continue;
    }

    console.error(`Missing value for argument: ${flag}`);
    console.error("Use --help for usage information");
    process.exit(1);
  }

  const sinceValue = parsed.since;
  if (typeof sinceValue === "string" && Number.isNaN(Date.parse(sinceValue))) {
    console.error(`Invalid --since value: ${sinceValue}`);
    console.error("Use a valid date, e.g. 2024-03-01 or 2024-03-01T10:30:00Z");
    process.exit(1);
  }

  const processAll = parsed["process-all"] === true || (!parsed.since && !parsed["campaign-id"] && !parsed.limit);

  const options = {
    campaignId: typeof parsed["campaign-id"] === "number" ? parsed["campaign-id"] : undefined,
    since: typeof parsed.since === "string" ? parsed.since : undefined,
    limit: typeof parsed.limit === "number" ? parsed.limit : undefined,
    processAll,
    dryRun: parsed["dry-run"] === true,
    moveToFolders: parsed["dry-run"] === true ? false : parsed["no-move-to-folders"] !== true,
    username: typeof parsed.user === "string" ? parsed.user : undefined,
    password: typeof parsed.password === "string" ? parsed.password : undefined,
  };

  return options;
}

function printUsage() {
  console.log(`
Reprocess Messages - Re-classify and re-embed existing messages

USAGE:
  reprocess-messages [options]

OPTIONS:
  --user <username>      JMAP username (default: STALWART_USERNAME env)
  --password <password>  JMAP app password (default: STALWART_APP_PASSWORD env)
  --process-all          Reprocess uncategorized messages from Stalwart inbox (campaign_id is null)
  --campaign-id <id>     Only reprocess messages for a specific campaign
  --since <date>         Only reprocess messages received after date (ISO 8601)
  --limit <number>       Maximum number of messages to reprocess
  --no-move-to-folders   Disable folder move after reclassification (enabled by default unless --dry-run)
  --dry-run              Preview messages without reprocessing
  -h, --help             Show this help message

ENVIRONMENT VARIABLES:
  SUPABASE_URL           Required Supabase URL
  SUPABASE_KEY           Required Supabase key
  STALWART_APP_PASSWORD  Required JMAP app password for fetching message content
  STALWART_USERNAME      Optional JMAP username

EXAMPLES:
  reprocess-messages --process-all
  reprocess-messages --process-all --no-move-to-folders
  reprocess-messages --limit 100
  reprocess-messages --campaign-id 5
  reprocess-messages --since "2024-03-01"
  reprocess-messages --dry-run --limit 10
`);
}

async function reprocessMessages(
  db: DatabaseClient,
  ai: Ai | null,
  options: ReprocessOptions,
): Promise<void> {
  const supabase = (db as any).supabase;

  if (!supabase) {
    throw new Error("Database client does not have Supabase instance");
  }

  // Build query to fetch messages - only from Stalwart inbox
  let query = supabase
    .from("messages")
    .select(`
      id,
      external_id,
      politician_id,
      campaign_id,
      classification_confidence,
      received_at,
      channel_source,
      stalwart_message_id,
      stalwart_account_id,
      politicians!inner(id, email)
    `)
    .not("stalwart_message_id", "is", null)
    .order("received_at", { ascending: false });

  if (options.campaignId) {
    query = query.eq("campaign_id", options.campaignId);
  }

  // When using --process-all, only process uncategorized messages (campaign_id is null)
  if (options.processAll) {
    query = query.is("campaign_id", null);
  }

  if (options.since) {
    query = query.gte("received_at", options.since);
  }

  if (options.limit) {
    query = query.limit(options.limit);
  }

  const { data: messages, error } = await query;

  if (error) {
    throw new Error(`Failed to fetch messages: ${error.message}`);
  }

  if (!messages || messages.length === 0) {
    console.log("No messages found to reprocess.");
    return;
  }

  console.log(`Found ${messages.length} message(s) to reprocess\n`);

  if (options.dryRun) {
    console.log("DRY RUN - Messages that would be reprocessed:");
    messages.forEach((msg: any, index: number) => {
      console.log(
        `${index + 1}. ID=${msg.id} external_id=${msg.external_id} campaign=${msg.campaign_id || "none"} confidence=${msg.classification_confidence || "n/a"} stalwart_id=${msg.stalwart_message_id}`
      );
    });
    return;
  }

  // Initialize JMAP connection if needed (for fetching content or moving folders)
  let jmapSession: JmapSessionResponse | null = null;
  let jmapAuthHeader: string | null = null;
  let jmapAccountId: string | null = null;

  const needsJmap = messages.some((msg: any) => msg.stalwart_message_id) || options.moveToFolders;

  if (needsJmap) {
    const username = options.username || process.env.STALWART_USERNAME;
    const password = options.password || process.env.STALWART_APP_PASSWORD || process.env.STALWART_PASSWORD;

    if (!username) {
      throw new Error("STALWART_USERNAME environment variable or --user must be set for JMAP access");
    }

    if (!password) {
      throw new Error("STALWART_APP_PASSWORD environment variable or --password must be set to fetch content from Stalwart");
    }

    const endpoint = process.env.STALWART_JMAP_ENDPOINT || STALWART_JMAP_ENDPOINT;
    jmapAuthHeader = encodeBasicAuth(username, password);

    console.log(`Connecting to Stalwart JMAP at ${endpoint}...`);
    jmapSession = await fetchJmapSession(endpoint, jmapAuthHeader);
    jmapAccountId = resolveAccountId(jmapSession);
    console.log("Connected to Stalwart\n");
  }

  const summary = {
    processed: 0,
    failed: 0,
    unchanged: 0,
    moved: 0,
  };

  // Cache for mailbox IDs to avoid repeated lookups
  const mailboxCache = new Map<string, string>();

  for (const message of messages) {
    try {
      let subject = "";
      let body = "";

      // Fetch content from Stalwart
      if (message.stalwart_message_id && jmapSession && jmapAuthHeader && jmapAccountId) {
        try {
          const email = await fetchEmailById(
            jmapSession.apiUrl,
            jmapAuthHeader,
            jmapAccountId,
            message.stalwart_message_id
          );

          if (email) {
            subject = email.subject || "";
            const textContent = extractBodyFromParts(email.textBody, email.bodyValues);
            const htmlContent = extractBodyFromParts(email.htmlBody, email.bodyValues);
            body = textContent || (htmlContent ? turndownService.turndown(htmlContent) : "");
          }
        } catch (jmapError) {
          console.warn(`  ⚠ Failed to fetch from Stalwart for message ${message.id}: ${jmapError instanceof Error ? jmapError.message : "Unknown error"}`);
        }
      }

      if (!subject && !body) {
        console.log(`Skipping message ${message.id}: No content available`);
        summary.unchanged += 1;
        continue;
      }

      // Generate new embedding
      const textForEmbedding = formatEmailContentForEmbedding(subject, body);
      const embedding = await generateEmbedding(ai, textForEmbedding);

      // Re-classify message
      const classification = await db.classifyMessage(
        embedding,
        message.politician_id,
        undefined // No campaign hint for reprocessing
      );

      // Update message with new classification and embedding
      const { error: updateError } = await supabase
        .from("messages")
        .update({
          campaign_id: classification.campaign_id,
          classification_confidence: classification.confidence,
          message_embedding: embedding,
        })
        .eq("id", message.id);

      if (updateError) {
        throw updateError;
      }

      // Only re-assign to cluster if confidence is low (uncategorized or poorly classified)
      if (classification.confidence < 0.5) {
        try {
          await db.assignMessageToCluster(message.id, embedding, message.politician_id);
        } catch (clusterError) {
          console.warn(`  ⚠ Failed to reassign to cluster: ${clusterError instanceof Error ? clusterError.message : "Unknown error"}`);
        }
      }

      summary.processed += 1;

      const oldCampaign = message.campaign_id || "none";
      const newCampaign = classification.campaign_id || "none";
      const changed = oldCampaign !== newCampaign ? " [CHANGED]" : "";

      console.log(
        `Reprocessed message ${message.id}: ${oldCampaign} → ${newCampaign} (confidence=${classification.confidence.toFixed(3)})${changed}`
      );

      // Move message to campaign folder if option is enabled
      if (options.moveToFolders && message.stalwart_message_id && jmapSession && jmapAuthHeader && jmapAccountId) {
        try {
          const folderPath = generateFolderPath(classification.campaign_name);

          // Check cache first
          let mailboxId = mailboxCache.get(folderPath);
          if (!mailboxId) {
            mailboxId = await ensureMailboxExists(
              jmapSession.apiUrl,
              jmapAuthHeader,
              jmapAccountId,
              folderPath,
            );
            mailboxCache.set(folderPath, mailboxId);
          }

          await moveEmailToMailbox(
            jmapSession.apiUrl,
            jmapAuthHeader,
            jmapAccountId,
            message.stalwart_message_id,
            mailboxId,
          );

          summary.moved += 1;
          console.log(`  📁 Moved to folder: ${folderPath}`);
        } catch (moveError) {
          console.warn(`  ⚠ Failed to move message: ${moveError instanceof Error ? moveError.message : "Unknown error"}`);
        }
      }
    } catch (error) {
      summary.failed += 1;
      const reason = error instanceof Error ? error.message : "Unknown error";
      console.error(`Failed to reprocess message ${message.id}: ${reason}`);
    }
  }

  console.log("\n=== Reprocessing Summary ===");
  console.log(`Processed: ${summary.processed}`);
  console.log(`Failed: ${summary.failed}`);
  console.log(`Unchanged: ${summary.unchanged}`);
  if (options.moveToFolders) {
    console.log(`Moved to folders: ${summary.moved}`);
  }
}

async function main() {
  const args = process.argv.slice(2);

  if (args.includes("--help") || args.includes("-h")) {
    printUsage();
    return;
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    console.error("Error: SUPABASE_URL and SUPABASE_KEY environment variables must be set");
    process.exit(1);
  }

  try {
    const db = new DatabaseClient({ url: supabaseUrl, key: supabaseKey });
    const options = parseArgs(args);

    await reprocessMessages(db, null, options);
    process.exit(0);
  } catch (error) {
    console.error("\nError reprocessing messages:");

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
