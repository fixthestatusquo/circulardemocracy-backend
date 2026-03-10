// src/stalwart.ts - Stalwart MTA Hook Worker
import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { cors } from "hono/cors";
import { DatabaseClient, type MessageInsert, hashEmail } from "./database";
import type { Ai } from "./message_processor";
import Turndown from "turndown";

// =============================================================================
// SENDER FLAG TYPE
// =============================================================================

type SenderFlag = "normal" | "replyToDiffers" | "suspicious";

// Environment variables interface
interface Env {
  AI: Ai;
  SUPABASE_URL: string;
  SUPABASE_KEY: string;
  API_KEY: string;
}

interface Variables {
  db: DatabaseClient;
}

// =============================================================================
// STALWART MTA HOOK SCHEMAS
// =============================================================================

const StalwartHookSchema = z.object({
  messageId: z.string().describe("Stalwart internal message ID"),
  queueId: z.string().optional().describe("Queue ID for tracking"),
  sender: z.string().email().describe("Envelope sender"),
  recipients: z.array(z.string().email()).describe("All envelope recipients"),
  headers: z
    .record(z.string(), z.union([z.string(), z.array(z.string())]))
    .describe("All email headers"),
  subject: z.string().optional(),
  body: z
    .object({
      text: z.string().optional().describe("Plain text body"),
      html: z.string().optional().describe("HTML body"),
    })
    .optional(),
  size: z.number().describe("Message size in bytes"),
  timestamp: z.number().describe("Unix timestamp when received"),
  spf: z
    .object({
      result: z.enum([
        "pass",
        "fail",
        "softfail",
        "neutral",
        "temperror",
        "permerror",
        "none",
      ]),
      domain: z.string().optional(),
    })
    .optional(),
  dkim: z
    .array(
      z.object({
        result: z.enum([
          "pass",
          "fail",
          "temperror",
          "permerror",
          "neutral",
          "none",
        ]),
        domain: z.string().optional(),
        selector: z.string().optional(),
      }),
    )
    .optional(),
  dmarc: z
    .object({
      result: z.enum(["pass", "fail", "temperror", "permerror", "none"]),
      policy: z.enum(["none", "quarantine", "reject"]).optional(),
    })
    .optional(),
});

const ErrorResponseSchema = z.object({
  action: z.literal("accept"),
  error: z.string(),
});

type ErrorResponse = z.infer<typeof ErrorResponseSchema>;

const StalwartResponseSchema = z.object({
  action: z.enum(["accept", "reject", "quarantine", "discard"]),
  modifications: z
    .object({
      folder: z.string().optional().describe("IMAP folder to store message"),
      headers: z.record(z.string(), z.string()).optional(),
      subject: z.string().optional(),
    })
    .optional(),
  reject_reason: z.string().optional(),
  confidence: z.number().min(0).max(1).optional(),
});

type StalwartResponse = z.infer<typeof StalwartResponseSchema>;

// =============================================================================
// STALWART WORKER APP
// =============================================================================

const app = new OpenAPIHono<{ Bindings: Env; Variables: Variables }>();

// CORS middleware
app.use(
  "/*",
  cors({
    origin: ["https://*.circulardemocracy.org", "http://localhost:*"],
    allowHeaders: ["Content-Type", "Authorization"],
    allowMethods: ["POST", "GET", "OPTIONS"],
  }),
);

// Database client middleware - allows injection for testing
app.use("*", async (c, next) => {
  const db = c.get("db") || new DatabaseClient({
    url: c.env.SUPABASE_URL,
    key: c.env.SUPABASE_KEY,
  });
  c.set("db", db);
  await next();
});

// =============================================================================
// MTA HOOK ROUTE
// =============================================================================

const mtaHookRoute = createRoute({
  method: "post",
  path: "/mta-hook",
  request: {
    body: {
      content: {
        "application/json": {
          schema: StalwartHookSchema,
        },
      },
    },
  },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: StalwartResponseSchema,
        },
      },
      description: "Instructions for message handling",
    },
    500: {
      content: {
        "application/json": {
          schema: ErrorResponseSchema,
        },
      },
      description: "Error - default to accept",
    },
  },
  tags: ["Stalwart"],
  summary: "/mta-hook",
  description: "Processes incoming emails and provides routing instructions",
});

app.openapi(mtaHookRoute, async (c) => {
  // Authentication check
  const apiKey = c.req.header("X-API-KEY");
  if (!apiKey || apiKey !== c.env.API_KEY) {
    return c.json(
      {
        action: "reject" as const,
        reject_reason: "Unauthorized: Invalid or missing API key",
      },
      401,
    );
  }

  const db = c.get("db");

  try {
    const hookData = c.req.valid("json");

    console.log(
      `Processing email: ${hookData.messageId} from ${hookData.sender}`,
    );

    // Extract actual sender from headers (considering SPF/DKIM)
    const senderEmail = extractSenderEmail(hookData);
    const senderName = extractSenderName(hookData);

    // Process all recipients and ensure they get the same campaign folder
    // First, classify the message once to determine the campaign
    const messageContent = extractMessageContent(hookData);
    let sharedCampaignClassification: { campaign_name: string; confidence: number; campaign_id: number } | null = null;

    if (messageContent.length >= 10) {
      try {
        const embedding = await generateEmbedding(c.env.AI, messageContent);
        sharedCampaignClassification = await db.classifyMessage(embedding);
      } catch (error) {
        console.error("Failed to classify message:", error);
      }
    }

    // Process each recipient with the shared campaign classification
    const results = await Promise.all(
      hookData.recipients.map(async (recipientEmail) => {
        return await processEmailForRecipient(
          db,
          c.env.AI,
          hookData,
          senderEmail,
          senderName,
          recipientEmail,
          sharedCampaignClassification,
        );
      }),
    );

    if (results.length === 0) {
      const emptyRes: StalwartResponse = {
        action: "accept",
        confidence: 0,
        reject_reason: "No recipients",
      };
      return c.json<StalwartResponse>(emptyRes);
    }

    // Use the result with highest confidence (they should all have same folder now)
    const bestResult: StalwartResponse = results.reduce((best, current) =>
      (current.confidence || 0) > (best.confidence || 0) ? current : best,
    );

    console.log(
      `Email processed: campaign=${bestResult.modifications?.headers?.["X-CircularDemocracy-Campaign"]}, confidence=${bestResult.confidence}`,
    );

    return c.json<StalwartResponse>(bestResult);
  } catch (error) {
    console.error("MTA Hook processing error:", error);

    // Always accept on error to avoid email loss
    const errorRes: ErrorResponse = {
      action: "accept",
      error: error instanceof Error ? error.message : "Unknown error",
    };
    // src/stalwart.ts - Stalwart MTA Hook Worker
    return c.json<ErrorResponse>(errorRes, 500);
  }
});

// Health check
app.get("/health", (c) => {
  return c.json({
    status: "ok",
    service: "stalwart-hook",
    timestamp: new Date().toISOString(),
  });
});

// =============================================================================
// EMAIL PROCESSING LOGIC
// =============================================================================

async function processEmailForRecipient(
  db: DatabaseClient,
  ai: Ai,
  hookData: z.infer<typeof StalwartHookSchema>,
  senderEmail: string,
  _senderName: string,
  recipientEmail: string,
  sharedCampaignClassification: { campaign_name: string; confidence: number; campaign_id: number } | null,
): Promise<StalwartResponse> {
  try {
    // Step 1: Check for duplicate message
    const isDuplicate = await db.checkExternalIdExists(
      hookData.messageId,
      "stalwart",
    );
    if (isDuplicate) {
      if (sharedCampaignClassification) {
        const campaignFolder = sharedCampaignClassification.campaign_name
          .replace(/[^a-zA-Z0-9\-_\s]/g, "")
          .replace(/\s+/g, "-")
          .substring(0, 50);
        return {
          action: "accept" as const,
          confidence: 1.0,
          modifications: {
            folder: `${campaignFolder}/Duplicates`,
            headers: { "X-CircularDemocracy-Status": "duplicate" },
          },
        };
      }
      return {
        action: "accept" as const,
        confidence: 1.0,
        modifications: {
          folder: "System/Duplicates",
          headers: { "X-CircularDemocracy-Status": "duplicate" },
        },
      };
    }

    // Step 2: Find target politician
    const politician = await db.findPoliticianByEmail(recipientEmail);
    if (!politician) {
      return {
        action: "accept" as const,
        confidence: 0.0,
        modifications: {
          folder: "System/Unknown",
          headers: { "X-CircularDemocracy-Status": "politician-not-found" },
        },
      };
    }

    // Step 3: Extract and validate message content
    const messageContent = extractMessageContent(hookData);
    if (messageContent.length < 10) {
      return {
        action: "accept" as const,
        confidence: 0.1,
        modifications: {
          folder: "System/TooShort",
          headers: { "X-CircularDemocracy-Status": "message-too-short" },
        },
      };
    }

    // Step 4: Use shared classification or classify if not available
    let classification: { campaign_name: string; confidence: number; campaign_id: number };
    let embedding: number[];
    if (sharedCampaignClassification) {
      classification = sharedCampaignClassification;
      embedding = await generateEmbedding(ai, messageContent);
    } else {
      embedding = await generateEmbedding(ai, messageContent);
      classification = await db.classifyMessage(embedding);
    }

    // Step 5: Check for logical duplicates
    const senderHash = await hashEmail(senderEmail);
    const duplicateRank = await db.getDuplicateRank(
      senderHash,
      politician.id,
      classification.campaign_id,
    );

    // Step 5b: Compute sender flag and reply status
    const replyToHeader = getHeader(hookData.headers, "reply-to");
    const fromHeader = getHeader(hookData.headers, "from");
    const replyToEmail = replyToHeader ? extractEmailFromHeader(replyToHeader) : null;
    const fromEmail = fromHeader ? extractEmailFromHeader(fromHeader) : null;
    const senderFlag: SenderFlag = determineSenderFlag(replyToEmail, fromEmail, hookData.sender);
    const isReply = detectReply(hookData.headers);

    if (senderFlag !== "normal") {
      console.log(
        `[Analytics] Flagged email: messageId=${hookData.messageId} senderFlag=${senderFlag} replyTo=${replyToEmail} from=${fromEmail} envelope=${hookData.sender}`,
      );
    }

    // Step 6: Store message metadata
    const messageData: MessageInsert = {
      external_id: hookData.messageId,
      channel: "email",
      channel_source: "stalwart",
      politician_id: politician.id,
      sender_hash: senderHash,
      campaign_id: classification.campaign_id,
      classification_confidence: classification.confidence,
      message_embedding: embedding,
      language: "auto", // TODO: detect language
      received_at: new Date(hookData.timestamp * 1000).toISOString(),
      duplicate_rank: duplicateRank,
      processing_status: "processed",
      sender_flag: senderFlag,
      is_reply: isReply,
    };

    await db.insertMessage(messageData);

    // Step 7: Generate folder and response
    const folderName = generateFolderName(classification, duplicateRank, isReply);

    return {
      action: "accept" as const,
      confidence: classification.confidence,
      modifications: {
        folder: folderName,
        headers: {
          "X-CircularDemocracy-Campaign": classification.campaign_name,
          "X-CircularDemocracy-Confidence":
            classification.confidence.toString(),
          "X-CircularDemocracy-Duplicate-Rank": duplicateRank.toString(),
          "X-CircularDemocracy-Message-ID": hookData.messageId,
          "X-CircularDemocracy-Politician": politician.name,
          "X-CircularDemocracy-Status": "processed",
        },
      },
    };
  } catch (error) {
    console.error(`Error processing email for ${recipientEmail}:`, error);
    return {
      action: "accept" as const,
      confidence: 0.0,
      modifications: {
        folder: "System/Unprocessed",
        headers: {
          "X-CircularDemocracy-Status": "error",
          "X-CircularDemocracy-Error":
            error instanceof Error ? error.message : "unknown",
        },
      },
    };
  }
}

// =============================================================================
// UTILITY FUNCTIONS
// =============================================================================

// Create a single Turndown instance for reuse
const turndownService = new Turndown({
  headingStyle: "atx",
  bulletListMarker: "-",
  codeBlockStyle: "fenced",
  fence: "```",
  emDelimiter: "*",
  strongDelimiter: "**",
  linkStyle: "inlined"
});

function extractEmailFromHeader(headerValue: string): string | null {
  const emailMatch = headerValue.match(/<([^>]+)>/) || [null, headerValue];
  const email = emailMatch[1]?.trim() || headerValue.trim();
  return email && isValidEmail(email) ? email : null;
}

function determineSenderFlag(
  replyToEmail: string | null,
  fromEmail: string | null,
  envelopeSender: string,
): SenderFlag {
  if (!replyToEmail) return "normal";
  const rt = replyToEmail.toLowerCase();
  const from = fromEmail?.toLowerCase() ?? null;
  const env = envelopeSender.toLowerCase();
  if (rt !== from && rt !== env) return "replyToDiffers";
  if (rt !== env) return "suspicious";
  return "normal";
}

function detectReply(headers: Record<string, string | string[]>): boolean {
  if (getHeader(headers, "in-reply-to") || getHeader(headers, "references")) return true;
  const subject = getHeader(headers, "subject");
  if (subject && /^(re:|fwd:|fw:)/i.test(subject.trim())) return true;
  return false;
}

function htmlToMarkdown(html: string): string {
  if (!html || html.trim().length === 0) {
    return "";
  }

  return turndownService.turndown(html).trim();
}

function extractSenderEmail(
  hookData: z.infer<typeof StalwartHookSchema>,
): string {
  // Priority: Reply-To > From > envelope sender (SPF considerations)
  const replyTo = getHeader(hookData.headers, "reply-to");
  if (replyTo && isValidEmail(replyTo)) {
    return replyTo;
  }

  const from = getHeader(hookData.headers, "from");
  if (from) {
    const emailMatch = from.match(/<([^>]+)>/) || [null, from];
    const email = emailMatch[1]?.trim();
    if (email && isValidEmail(email)) {
      return email;
    }
  }

  return hookData.sender;
}

function extractSenderName(
  hookData: z.infer<typeof StalwartHookSchema>,
): string {
  const from = getHeader(hookData.headers, "from");
  if (from) {
    const nameMatch = from.match(/^([^<]+)</);
    if (nameMatch) {
      return nameMatch[1].trim().replace(/^["']|["']$/g, "");
    }
  }

  const email = extractSenderEmail(hookData);
  return email.split("@")[0];
}

function extractMessageContent(
  hookData: z.infer<typeof StalwartHookSchema>,
): string {
  // Prefer HTML (converted to Markdown) over plain text
  const htmlContent = hookData.body?.html;
  if (htmlContent && htmlContent.trim().length > 0) {
    return htmlToMarkdown(htmlContent);
  }

  const textContent = hookData.body?.text;
  if (textContent && textContent.trim().length > 0) {
    return cleanTextContent(textContent);
  }

  return hookData.subject || "";
}

function cleanTextContent(text: string): string {
  return text
    .replace(/^>.*$/gm, "") // Remove quoted lines
    .replace(/^\s*On .* wrote:\s*$/gm, "") // Remove reply headers
    .replace(/\n{3,}/g, "\n\n") // Normalize newlines
    .trim();
}

function getHeader(
  headers: Record<string, string | string[]>,
  name: string,
): string | null {
  const value = headers[name.toLowerCase()];
  return Array.isArray(value) ? value[0] || null : value || null;
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function generateFolderName(
  classification: { campaign_name: string; confidence: number },
  duplicateRank: number,
  isReply = false,
): string {
  const campaignFolder = classification.campaign_name
    .replace(/[^a-zA-Z0-9\-_\s]/g, "")
    .replace(/\s+/g, "-")
    .substring(0, 50); // Limit folder name length

  if (duplicateRank > 0) {
    return `${campaignFolder}/Duplicates`;
  }

  if (classification.confidence < 0.3) {
    return `${campaignFolder}/unchecked`;
  }

  if (isReply) {
    return `${campaignFolder}/replied`;
  }

  return `${campaignFolder}/inbox`;
}

async function generateEmbedding(ai: Ai, text: string): Promise<number[]> {
  try {
    const response = await ai.run("@cf/baai/bge-m3", {
      text: text.substring(0, 8000),
    });

    return response.data[0] as number[];
  } catch (error) {
    console.error("Embedding generation error:", error);
    throw new Error("Failed to generate message embedding");
  }
}

// OpenAPI documentation
app.doc("/openapi.json", {
  openapi: "3.0.0",
  info: {
    version: "1.0.0",
    title: "Stalwart MTA Hook API",
    description: "Processes incoming emails via Stalwart mail server hooks",
  },
  servers: [
    {
      url: "https://stalwart.circulardemocracy.org",
      description: "Production Stalwart hook server",
    },
  ],
});

export default app;
