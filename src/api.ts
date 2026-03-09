import { OpenAPIHono } from "@hono/zod-openapi";
import { cors } from "hono/cors";
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

// Shared middleware
app.use(
  "/api/*",
  cors({
    origin: ["https://*.circulardemocracy.org", "http://localhost:*"],
    allowHeaders: ["Content-Type", "Authorization"],
    allowMethods: ["POST", "GET", "OPTIONS"],
  }),
);

app.use("/api/*", async (c, next) => {
  c.set(
    "db",
    new DatabaseClient({ url: c.env.SUPABASE_URL, key: c.env.SUPABASE_KEY }),
  );
  await next();
});

// Auth middleware for API routes
app.use("/api/v1/messages", apiKeyAuthMiddleware);

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
