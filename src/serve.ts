import { serve } from "@hono/node-server";
import dotenv from "dotenv";
import app from "./index";
import { serveStatic } from "@hono/node-server/serve-static";

// Load environment variables from .env file for development
dotenv.config();

app.get('/doc', serveStatic({ path: './doc/openapi.html' }));

serve(app, (info) => {
  console.log(`Listening on http://localhost:${info.port}`);
});

export default app;
