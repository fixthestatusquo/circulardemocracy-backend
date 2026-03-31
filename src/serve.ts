import { serve } from "@hono/node-server";
import { app } from "./index";
import { serveStatic } from "@hono/node-server/serve-static";
import * as dotenv from "dotenv";

// Load environment variables
dotenv.config();

app.get('/doc', serveStatic({ path: './doc/openapi.html' }));

serve({
  fetch: (request: Request) => {
    return app.fetch(request, {
      API_KEY: process.env.API_KEY || "",
      SUPABASE_URL: process.env.SUPABASE_URL || "",
      SUPABASE_KEY: process.env.SUPABASE_KEY || "",
      AI: null as any, // Not available in dev mode
    });
  },
  port: 3000,
}, (info) => {
  console.log(`Listening on http://localhost:${info.port}`);
  console.log(`API_KEY loaded: ${process.env.API_KEY ? '✅' : '❌'}`);
});

export default app;
