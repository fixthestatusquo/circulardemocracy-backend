import { OpenAPIHono } from "@hono/zod-openapi";
import analyticsApp from "./analytics";
import campaignsApp from "./campaigns";
import { DatabaseClient } from "./database";
import loginApp from "./login";
import type { Ai } from "./message_processor";
// Import modular route handlers
import messagesApp from "./messages";
import politiciansApp from "./politicians";
import replyTemplatesApp from "./reply_templates";
import { processScheduledReplies, type WorkerConfig } from "./reply_worker";

// Define types for env and app
interface Env {
  AI: Ai;
  SUPABASE_URL: string;
  SUPABASE_KEY: string;
  API_KEY: string;
  JMAP_API_URL: string;
  JMAP_ACCOUNT_ID: string;
  JMAP_USERNAME: string;
  JMAP_PASSWORD: string;
}

interface Variables {
  db: DatabaseClient;
}

const app = new OpenAPIHono<{ Bindings: Env; Variables: Variables }>();

app.use("/api/*", async (c, next) => {
  c.set(
    "db",
    new DatabaseClient({
      url: process.env.SUPABASE_URL || c.env.SUPABASE_URL,
      key: process.env.SUPABASE_KEY || c.env.SUPABASE_KEY,
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

// Health check for the entire API
app.get("/health", (c) => {
  return c.json({
    status: "ok",
    service: "main-api",
    timestamp: new Date().toISOString(),
    version: "1.0.0",
  });
});

// =============================================================================
// WORKER ENDPOINTS
// =============================================================================

/**
 * Manual trigger endpoint for reply worker (testing/admin)
 * POST /api/v1/worker/process-replies
 */
app.post("/api/v1/worker/process-replies", async (c) => {
  try {
    const db = c.get("db") as DatabaseClient;

    const workerConfig: WorkerConfig = {
      jmapApiUrl: c.env.JMAP_API_URL,
      jmapAccountId: c.env.JMAP_ACCOUNT_ID,
      jmapUsername: c.env.JMAP_USERNAME,
      jmapPassword: c.env.JMAP_PASSWORD,
    };

    const result = await processScheduledReplies(db, workerConfig);

    return c.json({
      success: true,
      result,
    });
  } catch (error) {
    console.error("Manual worker trigger error:", error);
    return c.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      },
      500,
    );
  }
});

/**
 * Health check for worker
 * GET /api/v1/worker/health
 */
app.get("/api/v1/worker/health", (c) => {
  return c.json({
    status: "ok",
    service: "reply-worker",
    timestamp: new Date().toISOString(),
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

    const workerConfig: WorkerConfig = {
      jmapApiUrl: env.JMAP_API_URL,
      jmapAccountId: env.JMAP_ACCOUNT_ID,
      jmapUsername: env.JMAP_USERNAME,
      jmapPassword: env.JMAP_PASSWORD,
    };

    const result = await processScheduledReplies(db, workerConfig);

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

app.openAPIRegistry.registerComponent("securitySchemes", "bearerAuth", {
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
