import { OpenAPIHono } from "@hono/zod-openapi";
import { apiKeyAuthMiddleware } from "./auth_middleware";
import { DatabaseClient } from "./database";
import type { Ai } from "./message_processor";

import campaignsApp from "./campaigns";
import loginApp from "./login";
// Import modular route handlers
import messagesApp from "./messages";
import politiciansApp from "./politicians";
import replyTemplatesApp from "./reply_templates";

// Define types for env and app
interface Env {
  AI: Ai;
  SUPABASE_URL: string;
  SUPABASE_KEY: string;
  API_KEY: string;
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
      key: process.env.SUPABASE_KEY || c.env.SUPABASE_KEY
    }),
  );
  await next();
});

// Mount modular routers
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
