import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import analyticsApp from "./analytics";
import campaignsApp from "./campaigns";
import { DatabaseClient } from "./database";
import loginApp from "./login";
import type { Ai } from "./message_processor";
// Import modular route handlers
import messagesApp from "./messages";
import politiciansApp from "./politicians";
import replyTemplatesApp from "./reply_templates";
import {
  type MailSendBindings,
  processScheduledReplies,
} from "./reply_worker";

// Define types for env and app
interface Env extends MailSendBindings {
  AI: Ai;
  SUPABASE_URL: string;
  SUPABASE_KEY: string;
  API_KEY: string;
}

interface Variables {
  db: DatabaseClient;
}

const app = new OpenAPIHono<{ Bindings: Env; Variables: Variables }>();

const MainHealthResponseSchema = z.object({
  status: z.literal("ok"),
  service: z.literal("main-api"),
  timestamp: z.string(),
  version: z.string(),
});


app.use("/api/*", async (c, next) => {
  c.set(
    "db",
    new DatabaseClient({
      url: process.env.SUPABASE_URL || c.env?.SUPABASE_URL,
      key: process.env.SUPABASE_KEY || c.env?.SUPABASE_KEY,
    }),
  );
  await next();
});

// Mount modular routers
app.route("/", analyticsApp);
app.route("/", messagesApp);
app.route("/", campaignsApp);
app.route("/", politiciansApp);
app.route("/", replyTemplatesApp);
app.route("/", loginApp);

const mainHealthRoute = createRoute({
  method: "get",
  path: "/health",
  responses: {
    200: {
      content: {
        "application/json": {
          schema: MainHealthResponseSchema,
        },
      },
      description: "Main API service health check",
    },
  },
  tags: ["System"],
  summary: "/health",
  description: "Check health status of the main API service",
});

app.openapi(mainHealthRoute, (c) => {
  return c.json({
    status: "ok",
    service: "main-api",
    timestamp: new Date().toISOString(),
    version: "1.0.0",
  });
});

// =============================================================================
// SCHEDULED EVENT HANDLER (for Cloudflare Cron Triggers)
// =============================================================================

/**
 * Handles scheduled events from Cloudflare Cron Triggers
 * This is exported and used in index.ts
 */
export async function handleScheduledEvent(env: Env): Promise<void> {
  console.log("[Reply Worker] Scheduled event triggered");

  try {
    const db = new DatabaseClient({
      url: env.SUPABASE_URL,
      key: env.SUPABASE_KEY,
    });

    const runtimeSecrets =
      env as unknown as Record<string, string | undefined>;
    const result = await processScheduledReplies(
      db,
      runtimeSecrets,
    );

    console.log("[Reply Worker] Processing complete:", {
      total: result.total,
      sent: result.sent,
      failed: result.failed,
      errors: result.errors.length,
    });

    if (result.errors.length > 0) {
      console.error("[Reply Worker] Errors encountered:", result.errors);
    }
  } catch (error) {
    console.error("[Reply Worker] Fatal error in scheduled event:", error);
  }
}

app.openAPIRegistry.registerComponent("securitySchemes", "Bearer", {
  type: "http",
  scheme: "bearer",
});

// OpenAPI documentation for all combined routes
app.doc("/openapi.json", {
  openapi: "3.0.0",
  info: {
    version: "1.0.0",
    title: "Circular Democracy API",
    description:
      "API for processing citizen messages, managing campaigns, and more.",
  },
  servers: [
    {
      url: "https://api.circulardemocracy.org",
      description: "production",
    },
    {
      url: "http://localhost:8787",
      description: "development",
    },
  ],
});

export default app;
