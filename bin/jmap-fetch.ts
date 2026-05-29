#!/usr/bin/env bun

import minimist from "minimist";
import { DatabaseClient } from "../src/database.js";
import {
  jmapWellKnownSessionUrl,
  resolveMailAccountIdFromSession,
} from "../src/jmap_client.js";
import { processMessage, PoliticianNotFoundError, type Ai, type MessageInput } from "../src/message_processor.js";
import {
  resolvePoliticianId,
  type CliFilters,
} from "../src/cli_shared.js";
import {
  buildStalwartImpersonationLogin,
  emailHostedOnDomain,
  encodeBasicAuth,
  normalizeMailDomain,
  resolveRelayImpersonationCredentials,
} from "../src/stalwart_jmap.js";
import { z } from "zod";
import Turndown from "turndown";
import { config as dotenv } from "dotenv";
import { pipeline, type FeatureExtractionPipeline } from "@xenova/transformers";

// Load `.env` once; all config is read from `process.env` below (no env.ts wrapper).
dotenv();

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

interface JmapSessionResponse {
  apiUrl: string;
  primaryAccounts?: Record<string, string>;
  accounts?: Record<string, unknown>;
}

interface JmapAddress {
  email?: string;
  name?: string;
}

interface JmapBodyPart {
  partId?: string;
}

interface JmapBodyValue {
  value?: string;
}

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
      "politician-name",
      "since",
      "message-id",
      "folder",
      "user",
      "password",
    ],
    boolean: ["process-all", "dry-run", "help"],
    alias: { h: "help" },
  });

  if (argv.help) {
    printUsage();
    process.exit(0);
  }

  const politicianId = argv["politician-id"];
  const politicianName = argv["politician-name"];

  if (politicianId !== undefined && politicianName !== undefined) {
    console.error("Use only one of --politician-id or --politician-name");
    process.exit(1);
  }

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

  return {
    politicianId: typeof politicianId === "number" ? politicianId : undefined,
    politicianName:
      typeof politicianName === "string" ? politicianName : undefined,
    processAll,
    since: typeof sinceValue === "string" ? sinceValue : undefined,
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
  console.log(`Accounts on @${domainKey} (${mailboxes.length}):`);
  if (mailboxes.length === 0) {
    console.log("  (none)");
    return;
  }
  const processingLower = processing?.trim().toLowerCase();
  for (let i = 0; i < mailboxes.length; i++) {
    const mailbox = mailboxes[i];
    const isCurrent =
      processingLower && mailbox.trim().toLowerCase() === processingLower;
    console.log(`  ${i + 1}. ${mailbox}${isCurrent ? "  <- current" : ""}`);
  }
  if (processing) {
    console.log(`\nCurrently processing: ${processing}`);
  }
}

function printUsage() {
  console.log(`
JMAP Fetch - Automated ingestion from Stalwart mail server

USAGE:
  jmap-fetch [--user <username>] [--password <password>] [options]
  jmap-fetch [--politician-id <id> | --politician-name <hint>] [options]

OPTIONS:
  --user <username>      JMAP mailbox email (default: JMAP_SERVICE_ACCOUNT_EMAIL env)
  --password <password>  JMAP app password (default: JMAP_SERVICE_ACCOUNT_PASSWORD env)
  --politician-id <id>    Filter by politician (numeric id)
  --politician-name <hint> Filter by politician (email exact or partial)
  --folder <name>        Additional mailbox/folder name to fetch from (optional; additive)
  --process-all          Fetch all available messages (default when no filter provided)
  --since <date>         Fetch messages received after date (ISO 8601)
  --message-id <id>      Fetch one specific message (JMAP ID or Message-ID header)
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
  jmap-fetch --process-all
  jmap-fetch --since "2024-03-01"
  jmap-fetch --politician-id 123
  jmap-fetch --user dibora --password mypass --process-all
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

function generateFolderPath(campaignName?: string | null): string {
  if (!campaignName) {
    return "Unclassified";
  }

  return campaignName
    .replace(/[^a-zA-Z0-9\-_\s]/g, "")
    .replace(/\s+/g, "-")
    .substring(0, 50) || "Unclassified";
}

async function ensureMailboxExists(
  apiUrl: string,
  authHeader: string,
  accountId: string,
  folderName: string,
): Promise<string> {
  const queryResponses = await jmapCall(apiUrl, authHeader, [
    [
      "Mailbox/query",
      {
        accountId,
        filter: { name: folderName },
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

  const createResponses = await jmapCall(apiUrl, authHeader, [
    [
      "Mailbox/set",
      {
        accountId,
        create: {
          newMailbox: { name: folderName },
        },
      },
      "createMailbox",
    ],
  ]);

  const setData = getMethodResponse(createResponses, "Mailbox/set", "createMailbox");
  if (setData.created?.newMailbox?.id) {
    return setData.created.newMailbox.id;
  }

  throw new Error(`Failed to create mailbox: ${folderName}`);
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

async function resolveInboxMailboxId(
  apiUrl: string,
  authHeader: string,
  accountId: string,
): Promise<string> {
  const queryResponses = await jmapCall(apiUrl, authHeader, [
    [
      "Mailbox/query",
      {
        accountId,
        filter: { role: "inbox" },
        position: 0,
        limit: 1,
      },
      "queryInboxMailbox",
    ],
    [
      "Mailbox/get",
      {
        accountId,
        "#ids": {
          resultOf: "queryInboxMailbox",
          name: "Mailbox/query",
          path: "/ids",
        },
      },
      "getInboxMailbox",
    ],
  ]);

  const getData = getMethodResponse(
    queryResponses,
    "Mailbox/get",
    "getInboxMailbox",
  );
  if (Array.isArray(getData.list) && getData.list.length > 0 && getData.list[0]?.id) {
    return getData.list[0].id as string;
  }

  throw new Error("Inbox mailbox not found for JMAP account");
}

async function resolveMailboxIdByName(
  apiUrl: string,
  authHeader: string,
  accountId: string,
  folderName: string,
): Promise<string | null> {
  const queryResponses = await jmapCall(apiUrl, authHeader, [
    [
      "Mailbox/query",
      {
        accountId,
        filter: { name: folderName },
        position: 0,
        limit: 1,
      },
      "queryMailboxByName",
    ],
    [
      "Mailbox/get",
      {
        accountId,
        "#ids": {
          resultOf: "queryMailboxByName",
          name: "Mailbox/query",
          path: "/ids",
        },
      },
      "getMailboxByName",
    ],
  ]);

  const getData = getMethodResponse(
    queryResponses,
    "Mailbox/get",
    "getMailboxByName",
  );
  if (Array.isArray(getData.list) && getData.list.length > 0 && getData.list[0]?.id) {
    return getData.list[0].id as string;
  }

  // Fallback: some servers/users vary mailbox casing ("Junk Mail" vs "junk mail").
  // Scan available mailboxes and match case-insensitively before failing.
  const allMailboxResponses = await jmapCall(apiUrl, authHeader, [
    [
      "Mailbox/get",
      {
        accountId,
        properties: ["id", "name"],
      },
      "getAllMailboxes",
    ],
  ]);
  const allMailboxes = getMethodResponse(
    allMailboxResponses,
    "Mailbox/get",
    "getAllMailboxes",
  );
  const normalizedTarget = folderName.trim().toLowerCase();
  if (Array.isArray(allMailboxes.list)) {
    const match = allMailboxes.list.find((mailbox: any) => {
      const name = typeof mailbox?.name === "string" ? mailbox.name.trim().toLowerCase() : "";
      return name === normalizedTarget;
    });
    if (match?.id) {
      return match.id as string;
    }
  }

  return null;
}

function buildMailboxFilter(mailboxIds: string[]): Record<string, unknown> {
  if (mailboxIds.length === 1) {
    return { inMailbox: mailboxIds[0] };
  }

  return {
    operator: "OR",
    conditions: mailboxIds.map((mailboxId) => ({ inMailbox: mailboxId })),
  };
}

async function fetchEmailPage(
  apiUrl: string,
  authHeader: string,
  accountId: string,
  filter: Record<string, unknown> | null,
  position: number,
  limit: number,
): Promise<JmapEmail[]> {
  const queryArgs: Record<string, unknown> = {
    accountId,
    position,
    limit,
  };
  if (filter !== null) {
    queryArgs.filter = filter;
  }
  const methodResponses = await jmapCall(apiUrl, authHeader, [
    [
      "Email/query",
      queryArgs,
      "query",
    ],
    [
      "Email/get",
      {
        accountId,
        "#ids": {
          resultOf: "query",
          name: "Email/query",
          path: "/ids",
        },
        properties: [
          "id",
          "messageId",
          "receivedAt",
          "mailboxIds",
          "subject",
          "from",
          "to",
          "cc",
          "replyTo",
          "preview",
          "textBody",
          "htmlBody",
          "bodyValues",
        ],
        fetchTextBodyValues: true,
        fetchHTMLBodyValues: true,
      },
      "get",
    ],
  ]);

  const queryData = getMethodResponse(methodResponses, "Email/query", "query");
  const getData = getMethodResponse(methodResponses, "Email/get", "get");
  const ids = Array.isArray(queryData.ids) ? queryData.ids : [];
  const list = Array.isArray(getData.list) ? getData.list : [];

  if (ids.length === 0) {
    return [];
  }

  return list as JmapEmail[];
}

async function fetchAllEmails(
  apiUrl: string,
  authHeader: string,
  accountId: string,
  filter: Record<string, unknown> | null,
): Promise<JmapEmail[]> {
  const pageSize = 50;
  let position = 0;
  const emails: JmapEmail[] = [];

  while (true) {
    const page = await fetchEmailPage(
      apiUrl,
      authHeader,
      accountId,
      filter,
      position,
      pageSize,
    );

    if (page.length === 0) {
      break;
    }

    emails.push(...page);

    if (page.length < pageSize) {
      break;
    }

    position += page.length;
  }

  return emails;
}

async function fetchEmailById(
  apiUrl: string,
  authHeader: string,
  accountId: string,
  sourceMailboxIds: string[],
  messageId: string,
): Promise<JmapEmail[]> {
  const directGetResponses = await jmapCall(apiUrl, authHeader, [
    [
      "Email/get",
      {
        accountId,
        ids: [messageId],
        properties: [
          "id",
          "messageId",
          "receivedAt",
          "mailboxIds",
          "subject",
          "from",
          "to",
          "cc",
          "replyTo",
          "preview",
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
    const directHits = (directGet.list as JmapEmail[]).filter(
      (email) => sourceMailboxIds.some((mailboxId) => email.mailboxIds?.[mailboxId] === true),
    );
    if (directHits.length > 0) {
      return directHits;
    }
  }

  const queryResponses = await jmapCall(apiUrl, authHeader, [
    [
      "Email/query",
      {
        accountId,
        filter: {
          operator: "AND",
          conditions: [
            buildMailboxFilter(sourceMailboxIds),
            { header: ["Message-ID", messageId] },
          ],
        },
        position: 0,
        limit: 1,
      },
      "queryByHeader",
    ],
    [
      "Email/get",
      {
        accountId,
        "#ids": {
          resultOf: "queryByHeader",
          name: "Email/query",
          path: "/ids",
        },
        properties: [
          "id",
          "messageId",
          "receivedAt",
          "mailboxIds",
          "subject",
          "from",
          "to",
          "cc",
          "replyTo",
          "preview",
          "textBody",
          "htmlBody",
          "bodyValues",
        ],
        fetchTextBodyValues: true,
        fetchHTMLBodyValues: true,
      },
      "getByHeader",
    ],
  ]);

  const byHeader = getMethodResponse(queryResponses, "Email/get", "getByHeader");
  return Array.isArray(byHeader.list)
    ? (byHeader.list as JmapEmail[]).filter(
      (email) => sourceMailboxIds.some((mailboxId) => email.mailboxIds?.[mailboxId] === true),
    )
    : [];
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
          campaign_name: hintCampaign.name,
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
          campaign_name: best.name,
          confidence: 1 - best.distance,
        };
      }
    }

    return {
      campaign_id: null,
      campaign_name: null,
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
      const senderColumnsMissing =
        errorText.includes("is_reply") || errorText.includes("sender_flag");

      if (!senderColumnsMissing) {
        throw new Error("Failed to store message in database");
      }

      const fallbackPayload = { ...insertPayload };
      delete fallbackPayload.is_reply;
      delete fallbackPayload.sender_flag;

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
): Promise<Set<string>> {
  const uniqueIds = Array.from(new Set(externalIds.filter((id) => id.trim().length > 0)));
  if (uniqueIds.length === 0) {
    return new Set<string>();
  }

  const supabase = (db as any).supabase;
  if (!supabase) {
    return new Set<string>();
  }

  const { data, error } = await supabase
    .from("messages")
    .select("external_id")
    .eq("channel_source", "stalwart")
    .eq("processing_status", "processed")
    .in("external_id", uniqueIds);

  if (error) {
    throw new Error(`Failed to check already processed messages: ${error.message}`);
  }

  return new Set((data || []).map((row: { external_id: string }) => row.external_id));
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
  const authHeader = encodeBasicAuth(username, password);
  const prefix = logMailbox ? `[${logMailbox}] ` : "";
  const impersonationIdx = username.indexOf("%");

  if (impersonationIdx > 0) {
    const target = username.slice(0, impersonationIdx);
    const impersonator = username.slice(impersonationIdx + 1);
    console.log(
      `${prefix}JMAP auth: Stalwart impersonation login "${target}%${impersonator}" (password: RELAY_SERVICE_ACCOUNT_PASSWORD)`,
    );
  } else {
    console.log(
      `${prefix}JMAP auth: direct Basic login as ${username} (password: JMAP_SERVICE_ACCOUNT_PASSWORD or --password)`,
    );
  }

  console.log(`${prefix}Connecting to Stalwart JMAP at ${jmapWellKnownUrl}...`);
  const session = await fetchJmapSession(jmapWellKnownUrl, authHeader);
  const accountId = resolveMailAccountIdFromSession(session);
  const inboxMailboxId = await resolveInboxMailboxId(
    session.apiUrl,
    authHeader,
    accountId,
  );
  const sourceMailboxIds = [inboxMailboxId];
  if (options.folder) {
    const folderMailboxId = await resolveMailboxIdByName(
      session.apiUrl,
      authHeader,
      accountId,
      options.folder,
    );
    if (!folderMailboxId) {
      throw new Error(`Mailbox not found for --folder: ${options.folder}`);
    }
    if (!sourceMailboxIds.includes(folderMailboxId)) {
      sourceMailboxIds.push(folderMailboxId);
    }
  }
  const mailboxCache = new Map<string, string>();

  let rawEmails: JmapEmail[] = [];
  if (options.messageId) {
    console.log(`Fetching message by ID: ${options.messageId}`);
    rawEmails = await fetchEmailById(
      session.apiUrl,
      authHeader,
      accountId,
      sourceMailboxIds,
      options.messageId,
    );
  } else if (options.since) {
    const sinceIso = toIsoDate(options.since);
    const sourceInfo = options.folder
      ? `Inbox + ${options.folder}`
      : "Inbox";
    console.log(`Fetching messages from ${sourceInfo} since ${sinceIso}`);
    rawEmails = await fetchAllEmails(
      session.apiUrl,
      authHeader,
      accountId,
      {
        operator: "AND",
        conditions: [
          buildMailboxFilter(sourceMailboxIds),
          { after: sinceIso },
        ],
      },
    );
  } else if (options.processAll) {
    if (options.folder) {
      console.log(`Fetching inbound messages from Inbox + ${options.folder}...`);
    } else {
      console.log("Fetching inbound inbox messages from Stalwart...");
    }
    rawEmails = await fetchAllEmails(
      session.apiUrl,
      authHeader,
      accountId,
      buildMailboxFilter(sourceMailboxIds),
    );
  }

  const processedExternalIds = await getAlreadyProcessedExternalIds(
    db,
    rawEmails.map((email) => email.id),
  );
  const unprocessedRawEmails = rawEmails.filter((email) => !processedExternalIds.has(email.id));

  if (processedExternalIds.size > 0) {
    console.log(`Skipping ${processedExternalIds.size} already processed message(s).`);
  }

  const validMessages: MessageInput[] = [];
  let skippedCount = 0;
  for (const rawEmail of unprocessedRawEmails) {
    try {
      validMessages.push(convertJmapEmailToMessageInput(rawEmail));
    } catch (error) {
      skippedCount += 1;
      const reason = error instanceof Error ? error.message : "Unknown validation error";
      console.warn(`Skipping message ${rawEmail.id}: ${reason}`);
    }
  }

  console.log(
    `${prefix}Fetched ${rawEmails.length} message(s); ${unprocessedRawEmails.length} unprocessed, ${validMessages.length} valid, ${skippedCount} skipped`,
  );

  if (options.dryRun) {
    printStalwartDryRun(validMessages);
    return true;
  }

  if (validMessages.length === 0) {
    console.log(`${prefix}No valid messages to process.`);
    return true;
  }

  const summary = {
    processed: 0,
    duplicates: 0,
    politicianNotFound: 0,
    failed: 0,
    moved: 0,
  };

  for (const messageInput of validMessages) {
    try {
      const result = await processMessage(db, ai, messageInput);
      if (result.success) {
        summary.processed += 1;
        console.log(
          `Processed ${messageInput.external_id} -> campaign=${result.campaign_name || "unknown"} confidence=${result.confidence ?? "n/a"}`,
        );
        const folderPath = generateFolderPath(result.campaign_name);
        try {
          let mailboxId = mailboxCache.get(folderPath);
          if (!mailboxId) {
            mailboxId = await ensureMailboxExists(session.apiUrl, authHeader, accountId, folderPath);
            mailboxCache.set(folderPath, mailboxId);
          }
          await moveEmailToMailbox(session.apiUrl, authHeader, accountId, messageInput.external_id, mailboxId);
          summary.moved += 1;
          console.log(`Moved ${messageInput.external_id} -> folder=${folderPath}`);
        } catch (moveError) {
          const reason = moveError instanceof Error ? moveError.message : "Unknown error";
          console.warn(`Failed to move ${messageInput.external_id}: ${reason}`);
        }
      } else if (result.status === "duplicate") {
        summary.duplicates += 1;
        console.log(`Duplicate ${messageInput.external_id}`);
      } else {
        summary.failed += 1;
        console.log(`Failed ${messageInput.external_id}: ${(result.errors || []).join(", ")}`);
      }
    } catch (error) {
      if (error instanceof PoliticianNotFoundError) {
        summary.politicianNotFound += 1;
        console.log(`Politician not found for ${messageInput.external_id}: ${error.message}`);
      } else {
        summary.failed += 1;
        const reason = error instanceof Error ? error.message : "Unknown error";
        console.log(`Error processing ${messageInput.external_id}: ${reason}`);
      }
    }
  }

  console.log(`\n${prefix}=== Stalwart Ingestion Summary ===`);
  console.log(`${prefix}Processed: ${summary.processed}`);
  console.log(`${prefix}Duplicates: ${summary.duplicates}`);
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
        console.log(
          `\n[${i + 1}/${mailboxes.length}] Currently processing: ${mailbox}`,
        );
        const principal = buildStalwartImpersonationLogin(
          relayCreds!.relayEmail,
          mailbox,
        );
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
      ingestPrincipal = buildStalwartImpersonationLogin(
        relayCreds!.relayEmail,
        explicitMailbox,
      );
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
