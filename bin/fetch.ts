#!/usr/bin/env bun

import minimist from "minimist";
import { DatabaseClient } from "../src/database.js";
import { jmapWellKnownSessionUrl } from "../src/jmap_client.js";
import { processMessage, processMessageBatch, PoliticianNotFoundError, type Ai, type MessageInput } from "../src/message_processor.js";
import {
  resolvePoliticianId,
  type CliFilters,
} from "../src/cli_shared.js";
import {
  emailHostedOnDomain,
  normalizeMailDomain,
  resolveRelayImpersonationCredentials,
} from "../src/stalwart_jmap.js";
import { JmapClient } from "jmap-cli";
import type { JmapMessage } from "jmap-cli";
import { z } from "zod";
import Turndown from "turndown";
import { config as dotenv } from "dotenv";
import { pipeline, type FeatureExtractionPipeline } from "@xenova/transformers";
import { isBounceEmail, extractBouncedMessageId, isAutoReply } from "../src/bounce_detector";

// Load `.env` once; all config is read from `process.env` below (no env.ts wrapper).
dotenv({ quiet: true });

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
});

type SenderFlag = "normal" | "replyToDiffers" | "suspicious";

interface StalwartFetchOptions extends CliFilters {
  processAll: boolean;
  since?: string;
  messageId?: string;
  folder?: string;
  user?: string;
  password?: string;
}

// Minimal JMAP types used by body extraction and conversion helpers.
interface JmapAddress { email?: string; name?: string; }
interface JmapBodyPart { partId?: string; }
interface JmapBodyValue { value?: string; }
interface JmapEmail {
  id: string;
  messageId?: string[];
  receivedAt?: string;
  mailboxIds?: Record<string, boolean>;
  subject?: string;
  from?: JmapAddress[];
  to?: JmapAddress[];
  cc?: JmapAddress[];
  replyTo?: JmapAddress[];
  preview?: string;
  textBody?: JmapBodyPart[];
  htmlBody?: JmapBodyPart[];
  bodyValues?: Record<string, JmapBodyValue>;
}

const turndownService = new Turndown({
  headingStyle: "atx",
  bulletListMarker: "-",
  codeBlockStyle: "fenced",
  fence: "```",
  emDelimiter: "*",
  strongDelimiter: "**",
  linkStyle: "inlined",
});

function parseStalwartArgs(args: string[]): StalwartFetchOptions {
  const argv = minimist(args, {
    string: [
      "politician-id",
      "politician-name",
      "since",
      "message-id",
      "folder",
      "user",
      "password",
      "limit",
    ],
    boolean: ["process-all", "dry-run", "help"],
    alias: { h: "help" },
    unknown: (d: string) => {
      if (d[0] !== "-") return true;
      console.error(`Unknown option: ${d}`);
      process.exit(1);
      return false;
    },
  });

  if (argv.help) {
    printUsage();
    process.exit(0);
  }

  const politicianIdRaw = argv["politician-id"];
  const politicianName = argv["politician-name"];

  if (politicianIdRaw !== undefined && politicianName !== undefined) {
    console.error("Use only one of --politician-id or --politician-name");
    process.exit(1);
  }

  const politicianId = typeof politicianIdRaw === "string"
    ? Number.parseInt(politicianIdRaw, 10)
    : typeof politicianIdRaw === "number"
      ? politicianIdRaw
      : undefined;

  const sinceValue = argv.since;
  if (typeof sinceValue === "string" && Number.isNaN(Date.parse(sinceValue))) {
    console.error(`Invalid --since value: ${sinceValue}`);
    console.error("Use a valid date, e.g. 2024-03-01 or 2024-03-01T10:30:00Z");
    process.exit(1);
  }

  const folderValue = argv.folder;
  if (typeof folderValue === "string" && folderValue.trim().length === 0) {
    console.error("Invalid --folder value: cannot be empty");
    console.error("Use --help for usage information");
    process.exit(1);
  }

  const processAll =
    argv["process-all"] === true || (!argv.since && !argv["message-id"]);

  const limitValue = argv.limit;
  const limit =
    typeof limitValue === "string"
      ? Number.parseInt(limitValue, 10)
      : typeof limitValue === "number"
        ? limitValue
        : undefined;

  return {
    politicianId: typeof politicianId === "number" ? politicianId : undefined,
    politicianName:
      typeof politicianName === "string" ? politicianName : undefined,
    processAll,
    since: typeof sinceValue === "string" ? sinceValue : undefined,
    limit: limit && Number.isFinite(limit) && limit > 0 ? limit : undefined,
    messageId:
      typeof argv["message-id"] === "string" ? argv["message-id"] : undefined,
    dryRun: argv["dry-run"] === true,
    folder: typeof folderValue === "string" ? folderValue.trim() : undefined,
    user: typeof argv.user === "string" ? argv.user : undefined,
    password: typeof argv.password === "string" ? argv.password : undefined,
  };
}

function logAllDomainMailboxes(
  domainKey: string,
  mailboxes: string[],
  processing?: string,
): void {
  console.log(`Accounts on @${domainKey} (${mailboxes.length})\n ${mailboxes.join(",")}`);
}

function printUsage() {
  console.log(`
Fetch - Automated ingestion from Stalwart mail server

USAGE:
  fetch [--user <username>] [--password <password>] [options]
  fetch [--politician-id <id> | --politician-name <hint>] [options]

OPTIONS:
  --user <username>      JMAP mailbox email (default: JMAP_SERVICE_ACCOUNT_EMAIL env)
  --password <password>  JMAP app password (default: JMAP_SERVICE_ACCOUNT_PASSWORD env)
  --politician-id <id>    Filter by politician (numeric id)
  --politician-name <hint> Filter by politician (email exact or partial)
  --folder <name>        Additional mailbox/folder name to fetch from (optional; additive)
  --process-all          Fetch all available messages (default when no filter provided)
  --since <date>         Fetch messages received after date (ISO 8601)
  --message-id <id>      Fetch one specific message (JMAP ID or Message-ID header)
  --limit <n>            Process at most <n> messages (default: all)
  --dry-run              Preview converted messages without processing/storage or folder moves
  -h, --help             Show this help message

ENVIRONMENT VARIABLES:
  JMAP_SERVICE_ACCOUNT_EMAIL      Required unless passed with --user
  JMAP_SERVICE_ACCOUNT_PASSWORD   Required app password for JMAP basic auth
  JMAP_URL                        Required. Mail server base URL (no path); session URL is JMAP_URL + "/.well-known/jmap"
  (Mail account id for this CLI comes from the JMAP session after login.)
  ALL_DOMAIN                      When set (e.g. example.org), impersonate via
                                  RELAY_SERVICE_ACCOUNT_EMAIL / RELAY_SERVICE_ACCOUNT_PASSWORD
                                  (login: target%relay). Without --user/--politician: all DB mailboxes on domain.
                                  With --user/--politician: one mailbox only.
  RELAY_SERVICE_ACCOUNT_EMAIL     Required for ALL_DOMAIN impersonation (impersonator account).
  RELAY_SERVICE_ACCOUNT_PASSWORD  Required for ALL_DOMAIN impersonation (impersonator password).
  SUPABASE_URL           Required Supabase URL
  SUPABASE_KEY           Required Supabase key

EXAMPLES:
  fetch --process-all
  fetch --since "2024-03-01"
  fetch --politician-id 123
  fetch --user dibora --password mypass --process-all
`);
}

class CliAi implements Ai {
  private static embeddingPipeline: FeatureExtractionPipeline | null = null;

  private static async getEmbeddingPipeline(): Promise<FeatureExtractionPipeline> {
    if (CliAi.embeddingPipeline) {
      return CliAi.embeddingPipeline;
    }

    console.log("Loading local BGE-M3 model for embeddings...");
    CliAi.embeddingPipeline = await pipeline("feature-extraction", "Xenova/bge-m3", {
      quantized: true,
    });
    console.log("BGE-M3 model loaded.");

    return CliAi.embeddingPipeline;
  }

  async run(model: string, inputs: any): Promise<any> {
    if (model === "@cf/baai/bge-m3" && typeof inputs?.text === "string") {
      const embeddingModel = await CliAi.getEmbeddingPipeline();
      const output = await embeddingModel(inputs.text.substring(0, 8000), {
        pooling: "mean",
        normalize: true,
      });
      const embedding = Array.from(output.data as Float32Array);
      return { data: [embedding] };
    }
    throw new Error(`Unsupported model or inputs: ${model}`);
  }
}

function determineSenderFlag(
  replyToEmail: string | undefined,
  fromEmail: string | undefined,
): SenderFlag {
  if (!replyToEmail || !fromEmail) {
    return "normal";
  }

  if (replyToEmail.toLowerCase() !== fromEmail.toLowerCase()) {
    return "replyToDiffers";
  }

  return "normal";
}

function normalizeAddress(address: JmapAddress | undefined): {
  email: string;
  name: string;
} {
  const email = address?.email?.trim() || "";
  const fallbackName = email.includes("@") ? email.split("@")[0] : "Unknown Sender";
  const name = address?.name?.trim() || fallbackName;

  return { email, name };
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

function toIsoDate(value?: string): string {
  if (!value) {
    return new Date().toISOString();
  }

  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) {
    return new Date().toISOString();
  }

  return new Date(parsed).toISOString();
}

function convertJmapEmailToMessageInput(email: JmapEmail): MessageInput {
  const fromAddress = normalizeAddress(email.from?.[0]);
  const replyToAddress = normalizeAddress(email.replyTo?.[0]);
  const toAddress = normalizeAddress(email.to?.[0] || email.cc?.[0]);

  const senderEmail = replyToAddress.email || fromAddress.email;
  const senderName = replyToAddress.name || fromAddress.name;
  const subject = (email.subject || "").trim();

  const textContent = extractBodyFromParts(email.textBody, email.bodyValues);
  const htmlContent = extractBodyFromParts(email.htmlBody, email.bodyValues);
  const markdownFromHtml = htmlContent ? turndownService.turndown(htmlContent).trim() : "";
  const messageBody = textContent || markdownFromHtml || (email.preview || "").trim() || subject;

  const messageInput: MessageInput = {
    external_id: email.id,
    sender_name: senderName || "Unknown Sender",
    sender_email: senderEmail,
    recipient_email: toAddress.email,
    subject,
    message: messageBody,
    text_content: textContent || undefined,
    html_content: htmlContent || undefined,
    timestamp: toIsoDate(email.receivedAt),
    channel_source: "stalwart",
    sender_flag: determineSenderFlag(replyToAddress.email, fromAddress.email),
  };

  return MessageInputSchema.parse(messageInput);
}

// --- JMAP helper: Email/query + Email/get with body content ---

interface JmapQueryResult {
  emails: JmapEmail[];
  total: number;
  position: number;
}

async function jmapQueryWithBodies(
  client: JmapClient,
  filter: Record<string, unknown> | null,
  limit = 50,
  position?: number,
): Promise<JmapQueryResult> {
  const session = await (client as any)._discoverSession();
  const accountId = client.getAccountId(session);
  const queryArgs: Record<string, unknown> = { accountId, limit };
  if (filter) queryArgs.filter = filter;
  if (position !== undefined) queryArgs.position = position;

  const json = await (client as any)._requestJson(session.apiUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      using: ["urn:ietf:params:jmap:core", "urn:ietf:params:jmap:mail"],
      methodCalls: [
        ["Email/query", queryArgs, "q"],
        ["Email/get", {
          accountId,
          "#ids": { resultOf: "q", name: "Email/query", path: "/ids" },
          properties: [
            "id", "messageId", "receivedAt", "mailboxIds",
            "subject", "from", "to", "cc", "replyTo",
            "preview", "textBody", "htmlBody", "bodyValues", "attachments", "headers",
          ],
          fetchTextBodyValues: true,
          fetchHTMLBodyValues: true,
        }, "g"],
      ],
    }),
  });

  const queryResp = json.methodResponses?.find((r: any[]) => r[0] === "Email/query");
  const getResp = json.methodResponses?.find((r: any[]) => r[0] === "Email/get");

  const emails = Array.isArray(getResp?.[1]?.list) ? getResp[1].list : [];
  const total = queryResp?.[1]?.total ?? 0;
  const respPosition = queryResp?.[1]?.position ?? 0;

  return { emails, total, position: respPosition };
}

// --- JMAP helper: fetch single email by Message-ID header ---

async function jmapFetchByMessageId(
  client: JmapClient,
  messageId: string,
  mailboxFilter: Record<string, unknown>,
): Promise<JmapEmail[]> {
  const session = await (client as any)._discoverSession();
  const accountId = client.getAccountId(session);

  const json = await (client as any)._requestJson(session.apiUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      using: ["urn:ietf:params:jmap:core", "urn:ietf:params:jmap:mail"],
      methodCalls: [
        ["Email/query", {
          accountId,
          filter: { operator: "AND", conditions: [mailboxFilter, { header: ["Message-ID", messageId] }] },
          limit: 1,
        }, "q"],
        ["Email/get", {
          accountId,
          "#ids": { resultOf: "q", name: "Email/query", path: "/ids" },
          properties: [
            "id", "messageId", "receivedAt", "mailboxIds",
            "subject", "from", "to", "cc", "replyTo",
            "preview", "textBody", "htmlBody", "bodyValues", "attachments", "headers",
          ],
          fetchTextBodyValues: true,
          fetchHTMLBodyValues: true,
        }, "g"],
      ],
    }),
  });

  const getResp = json.methodResponses?.find((r: any[]) => r[0] === "Email/get");
  return Array.isArray(getResp?.[1]?.list) ? getResp[1].list : [];
}

function generateFolderPath(campaignName?: string | null): string {
  if (!campaignName) {
    return "Unclassified";
  }

  return campaignName
    .replace(/[^a-zA-Z0-9\-_\s]/g, "")
    .replace(/\s+/g, "-")
    .substring(0, 50) || "Unclassified";
}

// --- jmap-cli wrappers for mailbox & move operations ---

async function ensureMailboxExists(
  client: JmapClient,
  folderName: string,
): Promise<string> {
  // Look up existing mailbox by name first (more reliable than createIfNotExist
  // since jmap-cli's getMailbox returns different shapes for found vs created).
  const mailboxes = await client.listMailboxes();
  const existing = mailboxes.find(
    (mb) => mb.name?.toLowerCase() === folderName.toLowerCase(),
  );
  if (existing?.id) return existing.id;

  // Create the mailbox
  const created = await client.createMailbox({ name: folderName });
  const id = (created as any)?.id;
  if (!id) throw new Error(`Could not create mailbox: ${folderName}`);
  return id;
}

async function moveEmailToMailbox(
  client: JmapClient,
  messageId: string,
  mailboxId: string,
): Promise<void> {
  await (client as any).updateMessage({
    messageId,
    update: { mailboxIds: { [mailboxId]: true } },
  });
}

function printStalwartDryRun(messages: MessageInput[]): void {
  console.log(`\nDry run: ${messages.length} message(s) ready for processing\n`);
  messages.forEach((message, index) => {
    console.log(
      `${index + 1}. external_id=${message.external_id} recipient=${message.recipient_email} sender=${message.sender_email} subject="${message.subject}" timestamp=${message.timestamp}`,
    );
  });
}

function toErrorText(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === "string") {
    return error;
  }

  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

function createCliCompatibleDb(db: DatabaseClient): DatabaseClient {
  const rawDb = db as any;
  const supabase = rawDb.supabase;

  if (!supabase) {
    return db;
  }

  const compatibleDb = Object.create(db) as DatabaseClient;

  (compatibleDb as any).classifyMessage = async (
    embedding: number[],
    _politicianId: number,
    campaignHint?: string,
  ) => {
    if (campaignHint) {
      const hintCampaign = await db.findCampaignByHint(campaignHint);
      if (hintCampaign) {
        return {
          campaign_id: hintCampaign.id,
          campaign_slug: hintCampaign.slug,
          confidence: 0.95,
        };
      }
    }

    const similarCampaigns = await db.findSimilarCampaigns(embedding, 3);
    if (similarCampaigns.length > 0) {
      const best = similarCampaigns[0];
      if (best.distance < 0.1) {
        return {
          campaign_id: best.id,
          campaign_slug: best.name,
          confidence: 1 - best.distance,
        };
      }
    }

    return {
      campaign_id: null,
      campaign_slug: null,
      confidence: 0.1,
    };
  };

  (compatibleDb as any).classifyAndAssignToCluster = async (
    messageId: number,
    embedding: number[],
    politicianId: number,
    campaignHint?: string,
  ) => {
    const classification = await (compatibleDb as any).classifyMessage(
      embedding,
      politicianId,
      campaignHint,
    );

    await db.updateMessageFields(messageId, {
      campaign_id: classification.campaign_id,
      classification_confidence: classification.confidence,
    });

    if (classification.campaign_id === null) {
      await db.assignMessageToCluster(messageId, embedding, politicianId);
    }
    return classification;
  };

  (compatibleDb as any).insertMessage = async (data: Record<string, unknown>) => {
    const insertPayload = Object.fromEntries(
      Object.entries(data).filter(([, value]) => value !== undefined),
    );

    const tryInsert = async (payload: Record<string, unknown>): Promise<number> => {
      const { data: result, error } = await supabase
        .from("messages")
        .insert(payload)
        .select("id");

      if (error) {
        throw error;
      }

      if (!result || result.length === 0 || !result[0]?.id) {
        throw new Error("Insert succeeded but returned no message id");
      }

      return result[0].id as number;
    };

    try {
      return await tryInsert(insertPayload);
    } catch (firstError) {
      const errorText = toErrorText(firstError).toLowerCase();

      // Unique constraint violation — message already exists, not a real failure
      if (errorText.includes("23505") || errorText.includes("duplicate key")) {
        // Fetch the existing message id and return it
        const externalId = insertPayload.external_id as string;
        const { data: existing } = await supabase
          .from("messages")
          .select("id")
          .eq("external_id", externalId)
          .limit(1);
        if (existing && existing.length > 0) {
          return existing[0].id as number;
        }
        throw new Error(`Duplicate message ${externalId} but could not find existing id`);
      }

      const missingColumn =
        errorText.includes("is_reply") ||
        errorText.includes("sender_flag") ||
        errorText.includes("reply_scheduled_at");

      if (!missingColumn) {
        console.error("Error inserting message:", toErrorText(firstError));
        throw new Error(`Failed to store message in database: ${toErrorText(firstError)}`);
      }

      const fallbackPayload = { ...insertPayload };
      delete fallbackPayload.is_reply;
      delete fallbackPayload.sender_flag;
      delete fallbackPayload.reply_scheduled_at;

      try {
        return await tryInsert(fallbackPayload);
      } catch (retryError) {
        console.error("Error inserting message (compat mode):", retryError);
        throw new Error("Failed to store message in database");
      }
    }
  };

  return compatibleDb;
}

async function getAlreadyProcessedExternalIds(
  db: DatabaseClient,
  externalIds: string[],
  politicianId?: number,
): Promise<Map<string, { campaign_slug: string | null }>> {
  const uniqueIds = Array.from(new Set(externalIds.filter((id) => id.trim().length > 0)));
  if (uniqueIds.length === 0) {
    return new Map();
  }

  const supabase = (db as any).supabase;
  if (!supabase) {
    return new Map();
  }

  let query = supabase
    .from("messages")
    .select("external_id, campaigns!inner(slug)")
    .eq("channel_source", "stalwart");

  if (politicianId !== undefined) {
    query = query.eq("politician_id", politicianId);
  }

  const { data, error } = await query.in("external_id", uniqueIds);

  if (error) {
    throw new Error(`Failed to check already processed messages: ${error.message}`);
  }

  const result = new Map<string, { campaign_slug: string | null }>();
  for (const row of data || []) {
    const slug = row.campaigns?.slug ?? null;
    result.set(row.external_id, { campaign_slug: slug });
  }
  return result;
}

async function runStalwartIngestion(
  db: DatabaseClient,
  ai: Ai,
  options: StalwartFetchOptions,
  username: string,
  password: string,
  jmapWellKnownUrl: string,
  logMailbox?: string,
): Promise<boolean> {
  const prefix = logMailbox ? `[${logMailbox}] ` : "";
  const impersonationIdx = username.indexOf("%");

  // Build jmap-cli client
  const baseUrl = jmapWellKnownUrl.replace(/\/\.well-known\/jmap\/?$/, "");
  const [impersonate, login] = impersonationIdx > 0
    ? [username.slice(0, impersonationIdx), username.slice(impersonationIdx + 1)]
    : [undefined, username];

  if (impersonationIdx > 0) {
    console.log(`${prefix}Stalwart impersonation: ${impersonate} via ${login}`);
  } else {
    console.log(`${prefix}direct login as ${username}`);
  }

  const client = new JmapClient({
    baseUrl,
    login: login!,
    password,
    impersonate,
  });

  // Resolve politician ID for deduplication
  let politicianId = options.politicianId;
  if (politicianId === undefined) {
    const mailboxEmail = logMailbox || (impersonate || login!);
    const politician = await db.findPoliticianByEmail(mailboxEmail);
    politicianId = politician?.id;
  }

  // Resolve inbox and optional folder
  const inbox = await client.getMailbox("inbox");
  if (!inbox?.id) throw new Error("Inbox mailbox not found");
  const sourceMailboxIds = [inbox.id];
  if (options.folder) {
    const folderMb = await client.getMailbox(options.folder);
    if (!folderMb?.id) throw new Error(`Mailbox not found for --folder: ${options.folder}`);
    if (!sourceMailboxIds.includes(folderMb.id)) sourceMailboxIds.push(folderMb.id);
  }

  const buildMailboxFilter = () =>
    sourceMailboxIds.length === 1
      ? { inMailbox: sourceMailboxIds[0] }
      : { operator: "OR" as const, conditions: sourceMailboxIds.map((id) => ({ inMailbox: id })) };

  const mailboxCache = new Map<string, string>();

  const allAlreadyProcessed = new Map<string, { campaign_slug: string | null }>();
  const validMessages: MessageInput[] = [];
  let skippedCount = 0;
  let rawEmails: JmapEmail[] = [];
  const summary = {
    processed: 0,
    duplicates: 0,
    bounced: 0,
    autoreplied: 0,
    politicianNotFound: 0,
    failed: 0,
    moved: 0,
  };

  if (options.messageId) {
    console.log(`Fetching message by ID: ${options.messageId}`);
    rawEmails = await jmapFetchByMessageId(client, options.messageId, buildMailboxFilter());
    if (rawEmails.length > 0) {
      const processed = await getAlreadyProcessedExternalIds(
        db, rawEmails.map((e) => e.id), politicianId,
      );
      for (const [id, info] of processed) allAlreadyProcessed.set(id, info);
      for (const rawEmail of rawEmails) {
        if (processed.has(rawEmail.id)) continue;
        try {
          validMessages.push(convertJmapEmailToMessageInput(rawEmail));
        } catch (error) {
          skippedCount += 1;
          const reason = error instanceof Error ? error.message : "Unknown validation error";
          console.warn(`Skipping message ${rawEmail.id}: ${reason}`);
        }
      }
    }
    // Process single message immediately
    for (const mi of validMessages) {
      try {
        const r = await processMessage(db, ai, mi);
        if (r.success) {
          summary.processed++;
          console.log(`Processed ${mi.external_id} -> campaign=${r.campaign_slug || "unknown"}`);
          const folderPath = generateFolderPath(r.campaign_slug);
          try {
            let mId = mailboxCache.get(folderPath);
            if (!mId) { mId = await ensureMailboxExists(client, folderPath); mailboxCache.set(folderPath, mId); }
            await moveEmailToMailbox(client, mi.external_id, mId);
            summary.moved++;
          } catch (moveError) {
            const reason = moveError instanceof Error ? moveError.message : "Unknown error";
            console.warn(`Failed to move ${mi.external_id}: ${reason}`);
          }
        } else if (r.status === "duplicate") {
          summary.duplicates++;
          console.log(`Duplicate ${mi.external_id}`);
        } else {
          summary.failed++;
        }
      } catch (error) {
        summary.failed++;
        const reason = error instanceof Error ? error.message : "Unknown error";
        console.log(`Error processing ${mi.external_id}: ${reason}`);
      }
    }
  } else {
    const sourceInfo = options.folder ? `Inbox + ${options.folder}` : "Inbox";
    const sinceInfo = options.since ? ` since ${toIsoDate(options.since)}` : "";
    console.log(`Fetching messages from ${sourceInfo}${sinceInfo}`);

    // Paginate through messages until we have enough valid (unprocessed) ones.
    // Using date-based pagination (after) instead of position to avoid
    // cursor invalidation when messages are moved out of the inbox.
    const batchSize = 50;
    const hasExplicitLimit = options.limit !== undefined;
    let afterTimestamp = options.since ? toIsoDate(options.since) : null;
    let pageNum = 0;
    const maxPages = 100;
    let totalValid = 0;

    const buildPageFilter = (after: string | null): Record<string, unknown> | null => {
      const conditions: Record<string, unknown>[] = [buildMailboxFilter()];
      if (after) conditions.push({ after });
      return { operator: "AND", conditions };
    };

    if (options.dryRun) {
      // For dry run: collect all valid messages first, then print
      while (pageNum < maxPages && (!hasExplicitLimit || validMessages.length < options.limit!)) {
        const pageFilter = buildPageFilter(afterTimestamp);
        const result = await jmapQueryWithBodies(client, pageFilter, batchSize);
        if (result.emails.length === 0) break;
        const alreadySeen = pageNum > 0 && rawEmails.length > 0 && rawEmails[0].id === result.emails[0].id;
        if (alreadySeen) { console.log(`${prefix}Server returned same page; stopping.`); break; }
        rawEmails.push(...result.emails);
        afterTimestamp = toIsoDate(result.emails[result.emails.length - 1].receivedAt);
        pageNum++;
        const pa = await getAlreadyProcessedExternalIds(db, result.emails.map((e) => e.id), politicianId);
        for (const [id, info] of pa) allAlreadyProcessed.set(id, info);
        for (const rawEmail of result.emails) {
          if (pa.has(rawEmail.id)) continue;
          try { validMessages.push(convertJmapEmailToMessageInput(rawEmail)); }
          catch { skippedCount++; }
        }
      }
      if (hasExplicitLimit && validMessages.length > options.limit!) validMessages.length = options.limit!;
      printStalwartDryRun(validMessages);
      return true;
    }

    while (pageNum < maxPages && (!hasExplicitLimit || totalValid < options.limit!)) {
      const pageFilter = buildPageFilter(afterTimestamp);
      const result = await jmapQueryWithBodies(client, pageFilter, batchSize);
      if (result.emails.length === 0) {
        console.log(`${prefix}End of mailbox (fetched ${rawEmails.length} total).`);
        break;
      }
      // Detect duplicate pages (server ignoring position parameter)
      const alreadySeen = pageNum > 0 && rawEmails.length > 0 && rawEmails[0].id === result.emails[0].id;
      if (alreadySeen) {
        console.log(`${prefix}Server returned same page (position ignored); stopping pagination.`);
        break;
      }
      rawEmails.push(...result.emails);
      afterTimestamp = toIsoDate(result.emails[result.emails.length - 1].receivedAt);
      pageNum++;

      // Check which emails in this page are already processed
      const pageAlreadyProcessed = await getAlreadyProcessedExternalIds(
        db, result.emails.map((e) => e.id), politicianId,
      );
      for (const [id, info] of pageAlreadyProcessed) allAlreadyProcessed.set(id, info);

      // Build page valid messages (skipping bounces and already-processed)
      const pageValid: MessageInput[] = [];
      for (const rawEmail of result.emails) {
        if (pageAlreadyProcessed.has(rawEmail.id)) continue;

        // Detect and handle bounce (DSN) emails
        const bounceAttach: { blobId?: string; type?: string } | undefined =
          ((rawEmail as any).attachments || []).find(
            (a: { type?: string }) => a.type === "message/rfc822",
          );
        const isBounce = isBounceEmail(rawEmail) || !!bounceAttach;
        if (isBounce) {
          summary.bounced++;
          if (bounceAttach?.blobId) {
            try {
              const session = await (client as any)._discoverSession();
              const accountId = client.getAccountId(session);
              const blobText: string = await (client as any)._downloadBlob(
                bounceAttach.blobId, accountId,
              );
              const bouncedId = extractBouncedMessageId(blobText);
              if (bouncedId !== null) {
                // Mark the matched message as bounced and get its sender_hash
                const { data: bouncedMsg } = await (db as any).supabase
                  .from("messages")
                  .update({ processing_status: "bounced" })
                  .eq("id", bouncedId)
                  .select("sender_hash")
                  .single();

                console.log(`Bounced ${rawEmail.id} -> matched message ${bouncedId}`);

                // Cascade to all unanswered messages with the same sender_hash
                if (bouncedMsg?.sender_hash) {
                  const { data: cascaded, error: cascadeError } = await (db as any).supabase
                    .from("messages")
                    .update({ processing_status: "bounced" })
                    .eq("sender_hash", bouncedMsg.sender_hash)
                    .eq("processing_status", "unanswered")
                    .neq("id", bouncedId)
                    .select("id");

                  if (!cascadeError) {
                    const cascadeCount = cascaded?.length || 0;
                    if (cascadeCount > 0) {
                      console.log(`  ↳ Cascaded bounce to ${cascadeCount} other unanswered message(s) with same sender_hash`);
                    }
                  }
                }
              } else {
                console.log(`Bounced ${rawEmail.id} (no matching reply Message-ID)`);
              }
            } catch (dlError) {
              console.warn(`Failed to process bounce ${rawEmail.id}: ${dlError}`);
            }
          } else {
            console.log(`Bounced ${rawEmail.id} (no message/rfc822 attachment)`);
          }

          // Move the bounce email to trash
          try {
            const trashId = await ensureMailboxExists(client, "Trash");
            if (trashId) {
              await moveEmailToMailbox(client, rawEmail.id, trashId);
              console.log(`Moved bounce ${rawEmail.id} to Trash`);
            }
          } catch (moveError) {
            console.warn(`Failed to move bounce ${rawEmail.id} to Trash: ${moveError}`);
          }

          continue;
        }

        // Detect and skip auto-reply / out-of-office emails
        if (isAutoReply(rawEmail)) {
          summary.autoreplied++;
          console.log(`Auto-reply ${rawEmail.id} (${rawEmail.subject})`);
          try {
            const trashId = await ensureMailboxExists(client, "Trash");
            if (trashId) {
              await moveEmailToMailbox(client, rawEmail.id, trashId);
            }
          } catch (moveError) {
            console.warn(`Failed to move auto-reply ${rawEmail.id} to Trash: ${moveError}`);
          }
          continue;
        }

        try { pageValid.push(convertJmapEmailToMessageInput(rawEmail)); }
        catch (error) {
          skippedCount += 1;
          const reason = error instanceof Error ? error.message : "Unknown validation error";
          console.warn(`Skipping message ${rawEmail.id}: ${reason}`);
        }
      }

      // Cap at limit if explicit
      if (hasExplicitLimit && totalValid + pageValid.length > options.limit!) {
        pageValid.length = options.limit! - totalValid;
      }
      totalValid += pageValid.length;

      console.log(
        `${prefix}Fetched page ${pageNum}: ${result.emails.length} messages` +
        ` (${pageValid.length} new, ${totalValid} valid total)`,
      );

      // --- Process this page immediately ---
      if (pageValid.length > 1) {
        try {
          const batchResults = await processMessageBatch(db, ai, pageValid);
          for (let i = 0; i < batchResults.length; i++) {
            const r = batchResults[i];
            const mi = pageValid[i];
            if (r.success) {
              summary.processed++;
              console.log(`Processed ${mi.external_id} -> campaign=${r.campaign_slug || "unknown"} confidence=${r.confidence ?? "n/a"}`);
              const folderPath = generateFolderPath(r.campaign_slug);
              try {
                let mId = mailboxCache.get(folderPath);
                if (!mId) { mId = await ensureMailboxExists(client, folderPath); mailboxCache.set(folderPath, mId); }
                await moveEmailToMailbox(client, mi.external_id, mId);
                summary.moved++;
              } catch (moveError) {
                const reason = moveError instanceof Error ? moveError.message : "Unknown error";
                console.warn(`Failed to move ${mi.external_id}: ${reason}`);
              }
            } else if (r.status === "duplicate") {
              summary.duplicates++;
              console.log(`Duplicate ${mi.external_id}`);
            } else {
              summary.failed++;
              console.log(`Failed ${mi.external_id}: ${(r.errors || []).join(", ")}`);
            }
          }
        } catch (error) {
          if (error instanceof PoliticianNotFoundError) {
            summary.politicianNotFound += pageValid.length;
            console.log(`Politician not found: ${error.message}`);
          } else {
            summary.failed += pageValid.length;
            const reason = error instanceof Error ? error.message : "Unknown error";
            console.log(`Error processing batch: ${reason}`);
          }
        }
      } else if (pageValid.length === 1) {
        const mi = pageValid[0];
        try {
          const r = await processMessage(db, ai, mi);
          if (r.success) {
            summary.processed++;
            console.log(`Processed ${mi.external_id} -> campaign=${r.campaign_slug || "unknown"} confidence=${r.confidence ?? "n/a"}`);
            const folderPath = generateFolderPath(r.campaign_slug);
            try {
              let mId = mailboxCache.get(folderPath);
              if (!mId) { mId = await ensureMailboxExists(client, folderPath); mailboxCache.set(folderPath, mId); }
              await moveEmailToMailbox(client, mi.external_id, mId);
              summary.moved++;
            } catch (moveError) {
              const reason = moveError instanceof Error ? moveError.message : "Unknown error";
              console.warn(`Failed to move ${mi.external_id}: ${reason}`);
            }
          } else if (r.status === "duplicate") {
            summary.duplicates++;
            console.log(`Duplicate ${mi.external_id}`);
          } else {
            summary.failed++;
            console.log(`Failed ${mi.external_id}: ${(r.errors || []).join(", ")}`);
          }
        } catch (error) {
          if (error instanceof PoliticianNotFoundError) {
            summary.politicianNotFound++;
            console.log(`Politician not found: ${error.message}`);
          } else {
            summary.failed++;
            const reason = error instanceof Error ? error.message : "Unknown error";
            console.log(`Error processing ${mi.external_id}: ${reason}`);
          }
        }
      }

      // Move already-processed messages in this page out of the inbox
      for (const rawEmail of result.emails) {
        const info = pageAlreadyProcessed.get(rawEmail.id);
        if (!info) continue;
        const folderPath = generateFolderPath(info.campaign_slug);
        try {
          let mId = mailboxCache.get(folderPath);
          if (!mId) { mId = await ensureMailboxExists(client, folderPath); mailboxCache.set(folderPath, mId); }
          await moveEmailToMailbox(client, rawEmail.id, mId);
          summary.moved++;
          console.log(`Moved already-processed ${rawEmail.id} -> folder=${folderPath}`);
        } catch (moveError) {
          const reason = moveError instanceof Error ? moveError.message : "Unknown error";
          console.warn(`Failed to move already-processed ${rawEmail.id}: ${reason}`);
        }
      }
    }
    if (pageNum >= maxPages) {
      console.log(`${prefix}Reached max ${maxPages} pages without exhausting results.`);
    }
  }

  console.log(`\n${prefix}=== Stalwart Ingestion Summary ===`);
  console.log(`${prefix}Processed: ${summary.processed}`);
  console.log(`${prefix}Duplicates: ${summary.duplicates}`);
  console.log(`${prefix}Bounced: ${summary.bounced}`);
  console.log(`${prefix}Auto-replies: ${summary.autoreplied}`);
  console.log(`${prefix}Politician not found: ${summary.politicianNotFound}`);
  console.log(`${prefix}Failed: ${summary.failed}`);
  console.log(`${prefix}Moved to folders: ${summary.moved}`);

  return summary.failed === 0;
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    printUsage();
    return;
  }

  const fetchOptions = parseStalwartArgs(args);

  const jmapServiceAccount = (process.env.JMAP_SERVICE_ACCOUNT_EMAIL || "").trim();
  const appPassword =
    (typeof fetchOptions.password === "string" ? fetchOptions.password.trim() : "") ||
    (process.env.JMAP_SERVICE_ACCOUNT_PASSWORD || "").trim();
  const allDomainRaw = (process.env.ALL_DOMAIN || "").trim();
  const relayCreds = resolveRelayImpersonationCredentials(process.env);
  const impersonationPassword = allDomainRaw
    ? (typeof fetchOptions.password === "string" ? fetchOptions.password.trim() : "") ||
      relayCreds?.relayPassword ||
      ""
    : appPassword;

  if (allDomainRaw && !relayCreds && !(typeof fetchOptions.password === "string")) {
    console.error(
      "Error: ALL_DOMAIN mode requires RELAY_SERVICE_ACCOUNT_EMAIL and RELAY_SERVICE_ACCOUNT_PASSWORD.",
    );
    process.exit(1);
  }

  if (allDomainRaw && !impersonationPassword) {
    console.error(
      "Error: ALL_DOMAIN impersonation needs RELAY_SERVICE_ACCOUNT_PASSWORD or --password.",
    );
    process.exit(1);
  }

  if (!allDomainRaw && !appPassword) {
    console.error(
      "Error: JMAP_SERVICE_ACCOUNT_PASSWORD environment variable or --password must be set",
    );
    console.error("Create an app password in Stalwart and export it before running CLI.");
    process.exit(1);
  }

  const jmapWellKnown = jmapWellKnownSessionUrl(process.env);
  if (!jmapWellKnown) {
    console.error(
      "Error: Set JMAP_URL to your mail server base URL (e.g. https://mail.example.org).",
    );
    process.exit(1);
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    console.error('Error: SUPABASE_URL and SUPABASE_KEY environment variables must be set');
    process.exit(1);
  }

  try {
    const db = createCliCompatibleDb(
      new DatabaseClient({ url: supabaseUrl, key: supabaseKey }),
    );

    const ai: Ai = new CliAi();

    let explicitMailbox = (typeof fetchOptions.user === "string" ? fetchOptions.user.trim() : "");
    const politicianId = await resolvePoliticianId(db, fetchOptions);

    if (politicianId !== undefined) {
      fetchOptions.politicianId = politicianId;
      const politician = await db.getPoliticianById(politicianId);
      if (politician) {
        if (explicitMailbox && explicitMailbox !== politician.email) {
          console.warn(
            `Warning: Overriding --user ${explicitMailbox} with politician email ${politician.email}`,
          );
        }
        explicitMailbox = politician.email;
      }
    }

    if (!allDomainRaw && !explicitMailbox && !jmapServiceAccount) {
      console.error(
        "Error: JMAP_SERVICE_ACCOUNT_EMAIL environment variable, --user, or --politician-* must be set",
      );
      process.exit(1);
    }

    if (allDomainRaw && !explicitMailbox) {
      const domainKey = normalizeMailDomain(allDomainRaw);
      const mailboxes = await db.listStalwartMailboxAddressesForDomain(domainKey);
      if (mailboxes.length === 0) {
        console.error(
          `Error: ALL_DOMAIN is set (${domainKey}) but no politician or campaign technical addresses match that domain in the database.`,
        );
        process.exit(1);
      }
      console.log(
        `ALL_DOMAIN mode: ingesting ${mailboxes.length} mailbox(es) on @${domainKey} using Stalwart impersonation.`,
      );
      logAllDomainMailboxes(domainKey, mailboxes);
      let allOk = true;
      for (let i = 0; i < mailboxes.length; i++) {
        const mailbox = mailboxes[i];
        const principal = `${mailbox}%${relayCreds!.relayEmail}`;
        const ok = await runStalwartIngestion(
          db,
          ai,
          fetchOptions,
          principal,
          impersonationPassword,
          jmapWellKnown,
          mailbox,
        );
        if (!ok) {
          allOk = false;
        }
      }
      process.exit(allOk ? 0 : 1);
    }

    let ingestPrincipal = explicitMailbox || jmapServiceAccount;
    let logMailbox: string | undefined;

    if (allDomainRaw && explicitMailbox) {
      const domainKey = normalizeMailDomain(allDomainRaw);
      if (!emailHostedOnDomain(explicitMailbox, domainKey)) {
        console.error(
          `Error: Target mailbox ${explicitMailbox} is not on ALL_DOMAIN ${domainKey}.`,
        );
        process.exit(1);
      }
      ingestPrincipal = `${explicitMailbox}%${relayCreds!.relayEmail}`;
      logMailbox = explicitMailbox;
      const domainMailboxes =
        await db.listStalwartMailboxAddressesForDomain(domainKey);
      console.log(
        `ALL_DOMAIN mode: ingesting single mailbox ${explicitMailbox} via Stalwart impersonation.`,
      );
      logAllDomainMailboxes(domainKey, domainMailboxes, explicitMailbox);
    }

    const success = await runStalwartIngestion(
      db,
      ai,
      fetchOptions,
      ingestPrincipal,
      allDomainRaw ? impersonationPassword : appPassword,
      jmapWellKnown,
      logMailbox,
    );
    process.exit(success ? 0 : 1);

  } catch (error) {
    console.error('\nError processing messages:');

    if (error instanceof Error) {
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
