import { randomBytes } from "node:crypto";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import * as dotenv from "dotenv";
import { app } from "./index";

// Load environment variables from .env file for development
dotenv.config();

app.get("/doc", serveStatic({ path: "./doc/openapi.html" }));

serve(
  {
    fetch: (request: Request) => {
      return app.fetch(request, {
        API_KEY: process.env.API_KEY || "",
        SUPABASE_URL: process.env.SUPABASE_URL || "",
        SUPABASE_KEY: process.env.SUPABASE_KEY || "",
        AI: null as any, // Not available in dev mode
        STALWART_JMAP_ENDPOINT: process.env.STALWART_JMAP_ENDPOINT || "",
        STALWART_JMAP_ACCOUNT_ID:
          process.env.STALWART_JMAP_ACCOUNT_ID ||
          process.env.JMAP_ACCOUNT_ID ||
          "",
        STALWART_USERNAME: process.env.STALWART_USERNAME || "",
        STALWART_APP_PASSWORD:
          process.env.STALWART_APP_PASSWORD ||
          process.env.STALWART_PASSWORD ||
          "",
        JMAP_API_URL: process.env.JMAP_API_URL || "",
        JMAP_ACCOUNT_ID: process.env.JMAP_ACCOUNT_ID || "",
        JMAP_USERNAME: process.env.JMAP_USERNAME || "",
        JMAP_PASSWORD: process.env.JMAP_PASSWORD || "",
      });
    },
    port: 3000,
  },
  (info) => {
    console.log(`Listening on http://localhost:${info.port}`);
    if (process.env.API_KEY) {
      console.log("API_KEY loaded: ✅");
    } else {
      const suggestedKey = randomBytes(32).toString("base64url");
      console.error(
        `API_KEY loaded: ❌ (missing API_KEY, add API_KEY=${suggestedKey} in your .env)`,
      );
    }
  },
);

export default app;
