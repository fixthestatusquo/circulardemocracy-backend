import { serve } from "@hono/node-server";
import { app } from "./index";
import { serveStatic } from "@hono/node-server/serve-static";

app.get('/doc', serveStatic({ path: './doc/openapi.html' }));

serve(app, (info) => {
  console.log(`Listening on http://localhost:${info.port}`);
});

export default app;
