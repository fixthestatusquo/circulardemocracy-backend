import { OpenAPIHono, createRoute } from "@hono/zod-openapi";
import { cors } from "hono/cors";
import { apiKeyAuthMiddleware } from "./auth_middleware";
import { DatabaseClient } from "./database";
import type { Ai } from "./message_processor";
import {
  StalwartHookSchema,
  StalwartResponseSchema,
  processStalwartHook,
  mapToStalwartResponse,
} from "./stalwart_adapter";

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

app.use(
  "/*",
  cors({
    origin: ["https://*.circulardemocracy.org", "http://localhost:*"],
    allowHeaders: ["Content-Type", "Authorization"],
    allowMethods: ["POST", "GET", "OPTIONS"],
  }),
);

app.use("*", async (c, next) => {
  c.set(
    "db",
    new DatabaseClient({
      url: c.env.SUPABASE_URL,
      key: c.env.SUPABASE_KEY,
    }),
  );
  await next();
});

app.use("/hook", apiKeyAuthMiddleware);

const stalwartHookRoute = createRoute({
  method: "post",
  path: "/api/v1/stalwart-hook/hook",
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
      description: "Stalwart hook response with routing instructions",
    },
  },
  tags: ["Stalwart"],
  summary: "/api/v1/stalwart-hook/hook",
  description: "Processes incoming emails from Stalwart MTA and provides routing instructions",
  security: [{ bearerAuth: [] }],
});

app.openapi(stalwartHookRoute, async (c) => {
  const db = c.get("db");

  try {
    const payload = c.req.valid("json");

    const result = await processStalwartHook(db, c.env.AI, payload);

    const response = mapToStalwartResponse(result);

    return c.json(response, 200);
  } catch (error) {
    console.error("Stalwart hook processing error:", error);

    return c.json(
      {
        action: "accept" as const,
      },
      200,
    );
  }
});

app.get("/health", (c) => {
  return c.json({
    status: "ok",
    service: "stalwart-hook",
    timestamp: new Date().toISOString(),
  });
});

app.openAPIRegistry.registerComponent("securitySchemes", "bearerAuth", {
  type: "http",
  scheme: "bearer",
});

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
