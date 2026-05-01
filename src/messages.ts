import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import {
  authMiddleware,
  canAccessPoliticianId,
  type AuthContext,
  requireAppRole,
} from "./auth";
import type { DatabaseClient } from "./database";
import {
  type Ai,
  PoliticianNotFoundError,
  processMessage,
} from "./message_processor";
import { processReplyImmediately } from "./reply_worker";
import { type MailSendBindings } from "./stalwart_jmap_env";

// Define types for env and app
interface Env extends MailSendBindings {
  AI: Ai; // Cloudflare Workers AI
  SUPABASE_URL: string;
  SUPABASE_KEY: string;
  API_KEY: string;
}

interface Variables {
  db: DatabaseClient;
  auth: AuthContext;
}

const app = new OpenAPIHono<{ Bindings: Env; Variables: Variables }>();
app.use("/api/v1/messages", authMiddleware);
app.use("/api/v1/messages", requireAppRole("politician", "staff", "admin"));

// Schemas specific to message processing
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
  html_content: z
    .string()
    .max(50000)
    .optional()
    .describe("HTML version of message content"),
  text_content: z
    .string()
    .max(50000)
    .optional()
    .describe("Plain text version of message content"),
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
});

const MessageResponseSchema = z.object({
  success: z.boolean(),
  message_id: z.number().optional(),
  status: z.enum(["processed", "failed", "politician_not_found", "duplicate"]),
  campaign_id: z.number().optional(),
  campaign_name: z.string().optional(),
  confidence: z.number().min(0).max(1).optional(),
  duplicate_rank: z.number().optional(),
  errors: z.array(z.string()).optional(),
});

const ErrorResponseSchema = z.object({
  success: z.boolean().default(false),
  error: z.string(),
  details: z.string().optional(),
});

// The message processing route definition
const messageRoute = createRoute({
  method: "post",
  path: "/api/v1/messages",
  request: {
    body: {
      content: {
        "application/json": {
          schema: MessageInputSchema,
        },
      },
    },
  },
  security: [
    {
      Bearer: [],
    },
  ],
  responses: {
    200: {
      content: {
        "application/json": {
          schema: MessageResponseSchema,
        },
      },
      description: "Message processed successfully",
    },
    400: {
      content: {
        "application/json": {
          schema: ErrorResponseSchema,
        },
      },
      description: "Invalid input data",
    },
    401: {
      content: {
        "application/json": {
          schema: ErrorResponseSchema,
        },
      },
      description: "Unauthorized - Invalid or missing Supabase JWT",
    },
    403: {
      content: {
        "application/json": {
          schema: ErrorResponseSchema,
        },
      },
      description: "Forbidden",
    },
    404: {
      content: {
        "application/json": {
          schema: MessageResponseSchema,
        },
      },
      description: "Politician not found",
    },
    409: {
      content: {
        "application/json": {
          schema: MessageResponseSchema,
        },
      },
      description: "Duplicate message",
    },
    500: {
      content: {
        "application/json": {
          schema: ErrorResponseSchema,
        },
      },
      description: "Internal server error",
    },
  },
  tags: ["Messages"],
  summary: "/api/v1/messages",
  description:
    "Receives a citizen message, classifies it by campaign, and stores it for politician response",
});

// The handler for the message route
app.openapi(messageRoute, async (c) => {
  const db = c.get("db") as DatabaseClient;
  const auth = c.get("auth") as AuthContext | undefined;
  if (!auth) {
    return c.json({ success: false, error: "Unauthorized" }, 401);
  }

  try {
    const data = c.req.valid("json");
    const politicianForAccess = await db.findPoliticianByEmail(
      data.recipient_email,
    );
    if (!politicianForAccess) {
      return c.json(
        {
          success: false,
          status: "politician_not_found" as const,
          errors: [`No politician found for email: ${data.recipient_email}`],
        },
        404,
      );
    }
    if (!canAccessPoliticianId(auth, politicianForAccess.id)) {
      return c.json({ success: false, error: "Forbidden" }, 403);
    }

    const runtimeSecrets =
      c.env as unknown as Record<string, string | undefined>;
    const result = await processMessage(
      db,
      c.env.AI,
      data,
      async (messageId: number) => {
        await processReplyImmediately(
          db,
          messageId,
          runtimeSecrets,
        );
      },
    );

    if (result.status === "duplicate") {
      return c.json(result, 409);
    }

    if (!result.success) {
      return c.json(
        {
          success: false,
          error: result.errors?.[0] ?? "Message processing failed",
          details: result.errors?.slice(1).join("; ") || undefined,
        },
        500,
      );
    }

    return c.json(result, 200);
  } catch (error) {
    if (error instanceof PoliticianNotFoundError) {
      return c.json(
        {
          success: false,
          status: "politician_not_found" as const,
          errors: [error.message],
        },
        404,
      );
    }

    console.error("Message processing error");
    return c.json(
      {
        success: false,
        error: "Internal server error",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      500,
    );
  }
});

export default app;
