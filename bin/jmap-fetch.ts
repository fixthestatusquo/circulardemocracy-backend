#!/usr/bin/env node

import { DatabaseClient } from "../src/database.js";
import { processMessage, PoliticianNotFoundError, type Ai, type MessageInput } from "../src/message_processor.js";
import { z } from "zod";
import Turndown from "turndown";

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

type SenderFlag = "normal" | "replyToDiffers" | "suspicious";

interface StalwartFetchOptions {
  processAll: boolean;
  since?: string;
  messageId?: string;
  dryRun: boolean;
  politicianId?: number;
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

const STALWART_JMAP_ENDPOINT =
  "https://mail.circulardemocracy.org/.well-known/jmap";
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
  const parsed: Record<string, string | boolean> = {};
  const booleanFlags = new Set([
    "process-all",
    "dry-run",
  ]);

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
      parsed[key] = args[i + 1];
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

  const processAll = parsed["process-all"] === true
    || (!parsed.since && !parsed["message-id"]);

  const politicianId = parsed["politician-id"];
  if (politicianId && typeof politicianId === "string") {
    const id = Number.parseInt(politicianId, 10);
    if (Number.isNaN(id)) {
      console.error(`Invalid --politician-id value: ${politicianId}`);
      console.error("Must be a valid integer");
      process.exit(1);
    }
  }

  return {
    processAll,
    since: typeof parsed.since === "string" ? parsed.since : undefined,
    messageId:
      typeof parsed["message-id"] === "string"
        ? parsed["message-id"]
        : undefined,
    dryRun: parsed["dry-run"] === true,
    politicianId: typeof parsed["politician-id"] === "string" ? Number.parseInt(parsed["politician-id"], 10) : undefined,
  };
}

function printUsage() {
  console.log(`
JMAP Fetch - Automated ingestion from Stalwart mail server

USAGE:
  jmap-fetch [--politician-id <id>] [options]

OPTIONS:
  --politician-id <id>   Fetch messages for specific politician (uses their JMAP credentials from DB)
  --process-all          Fetch all available messages (default when no filter provided)
  --since <date>         Fetch messages received after date (ISO 8601)
  --message-id <id>      Fetch one specific message (JMAP ID or Message-ID header)
  --dry-run              Preview converted messages without processing/storage
  -h, --help             Show this help message

ENVIRONMENT VARIABLES:
  SUPABASE_URL           Required Supabase URL
  SUPABASE_KEY           Required Supabase key

EXAMPLES:
  jmap-fetch --politician-id 1 --process-all
  jmap-fetch --politician-id 1 --since "2024-03-01"
  jmap-fetch --politician-id 1 --message-id "specific-id"
  jmap-fetch --politician-id 1 --dry-run --since "2024-03-01"

NOTE:
  Each politician must have their JMAP credentials configured in the database.
  Use the politicians table columns: stalwart_username, stalwart_app_password, stalwart_jmap_endpoint
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

function detectReplyFromSubject(subject: string): boolean {
  return /^(re:|fwd:|fw:)/i.test(subject.trim());
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
    is_reply: detectReplyFromSubject(subject),
  };

  return MessageInputSchema.parse(messageInput);
}

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

async function fetchEmailPage(
  apiUrl: string,
  authHeader: string,
  accountId: string,
  filter: Record<string, unknown> | null,
  position: number,
  limit: number,
): Promise<JmapEmail[]> {
  const methodResponses = await jmapCall(apiUrl, authHeader, [
    [
      "Email/query",
      {
        accountId,
        filter,
        position,
        limit,
      },
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
    return directGet.list as JmapEmail[];
  }

  const queryResponses = await jmapCall(apiUrl, authHeader, [
    [
      "Email/query",
      {
        accountId,
        filter: {
          header: ["Message-ID", messageId],
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
  return Array.isArray(byHeader.list) ? (byHeader.list as JmapEmail[]) : [];
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

  (compatibleDb as any).findSimilarCampaigns = async (_embedding: number[], limit = 3) => {
    const { data, error } = await supabase
      .from("campaigns")
      .select("id,name,slug,status")
      .in("status", ["active", "unconfirmed"])
      .not("reference_vector", "is", null)
      .limit(limit);

    if (error) {
      throw error;
    }

    return (data || []).map((campaign: any) => ({
      ...campaign,
      similarity: 0.1,
    }));
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

async function runStalwartIngestion(
  db: DatabaseClient,
  ai: Ai,
  options: StalwartFetchOptions,
): Promise<boolean> {
  // Fetch politician and their JMAP credentials from database
  if (!options.politicianId) {
    console.error("Error: --politician-id is required");
    console.error("Use --help for usage information");
    process.exit(1);
  }

  const politician = await getPoliticianWithCredentials(db, options.politicianId);
  if (!politician) {
    console.error(`Error: Politician with ID ${options.politicianId} not found`);
    process.exit(1);
  }

  if (!politician.stalwart_username || !politician.stalwart_app_password) {
    console.error(`Error: Politician ${options.politicianId} missing JMAP credentials`);
    console.error("Please configure stalwart_username and stalwart_app_password in the database");
    process.exit(1);
  }

  const endpoint = politician.stalwart_jmap_endpoint || STALWART_JMAP_ENDPOINT;
  const username = politician.stalwart_username;
  const password = politician.stalwart_app_password;

  const authHeader = encodeBasicAuth(username, password);

  console.log(`Connecting to Stalwart JMAP at ${endpoint} for politician ${politician.name} (${politician.email})...`);
  const session = await fetchJmapSession(endpoint, authHeader);
  const accountId = resolveAccountId(session);

  let rawEmails: JmapEmail[] = [];
  if (options.messageId) {
    console.log(`Fetching message by ID: ${options.messageId}`);
    rawEmails = await fetchEmailById(
      session.apiUrl,
      authHeader,
      accountId,
      options.messageId,
    );
  } else if (options.since) {
    const sinceIso = toIsoDate(options.since);
    console.log(`Fetching messages since ${sinceIso}`);
    rawEmails = await fetchAllEmails(
      session.apiUrl,
      authHeader,
      accountId,
      { after: sinceIso },
    );
  } else if (options.processAll) {
    console.log("Fetching all messages from Stalwart...");
    rawEmails = await fetchAllEmails(
      session.apiUrl,
      authHeader,
      accountId,
      null,
    );
  }

  const validMessages: MessageInput[] = [];
  let skippedCount = 0;
  for (const rawEmail of rawEmails) {
    try {
      validMessages.push(convertJmapEmailToMessageInput(rawEmail));
    } catch (error) {
      skippedCount += 1;
      const reason = error instanceof Error ? error.message : "Unknown validation error";
      console.warn(`Skipping message ${rawEmail.id}: ${reason}`);
    }
  }

  console.log(
    `Fetched ${rawEmails.length} message(s); ${validMessages.length} valid, ${skippedCount} skipped`,
  );

  if (options.dryRun) {
    printStalwartDryRun(validMessages);
    return true;
  }

  if (validMessages.length === 0) {
    console.log("No valid messages to process.");
    return true;
  }

  const summary = {
    processed: 0,
    duplicates: 0,
    politicianNotFound: 0,
    failed: 0,
  };

  for (const messageInput of validMessages) {
    try {
      const result = await processMessage(db, ai, messageInput);
      if (result.success) {
        summary.processed += 1;
        console.log(
          `Processed ${messageInput.external_id} -> campaign=${result.campaign_name || "unknown"} confidence=${result.confidence ?? "n/a"}`,
        );
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

  console.log("\n=== Stalwart Ingestion Summary ===");
  console.log(`Processed: ${summary.processed}`);
  console.log(`Duplicates: ${summary.duplicates}`);
  console.log(`Politician not found: ${summary.politicianNotFound}`);
  console.log(`Failed: ${summary.failed}`);

  return summary.failed === 0;
}

async function getPoliticianWithCredentials(
  db: DatabaseClient,
  politicianId: number,
): Promise<{
  id: number;
  name: string;
  email: string;
  stalwart_username?: string | null;
  stalwart_app_password?: string | null;
  stalwart_jmap_endpoint?: string | null;
} | null> {
  try {
    const { data, error } = await (db as any).supabase
      .from("politicians")
      .select("id, name, email, stalwart_username, stalwart_app_password, stalwart_jmap_endpoint")
      .eq("id", politicianId)
      .eq("active", true)
      .limit(1);

    if (error) {
      throw error;
    }

    return data && data.length > 0 ? data[0] : null;
  } catch (error) {
    console.error("Error fetching politician:", error);
    return null;
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
    console.error('Error: SUPABASE_URL and SUPABASE_KEY environment variables must be set');
    process.exit(1);
  }

  try {
    const db = createCliCompatibleDb(
      new DatabaseClient({ url: supabaseUrl, key: supabaseKey }),
    );

    const ai: Ai = new CliAi();

    const fetchOptions = parseStalwartArgs(args);
    const success = await runStalwartIngestion(db, ai, fetchOptions);
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
