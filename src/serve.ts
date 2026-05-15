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
        JMAP_URL: process.env.JMAP_URL || "",
        SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY || "",
        RELAY_SERVICE_ACCOUNT_EMAIL:
          process.env.RELAY_SERVICE_ACCOUNT_EMAIL || "",
        RELAY_SERVICE_ACCOUNT_PASSWORD:
          process.env.RELAY_SERVICE_ACCOUNT_PASSWORD || "",
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
