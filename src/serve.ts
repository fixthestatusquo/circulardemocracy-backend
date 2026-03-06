import { serve } from "@hono/node-server";
import app from "./index";

serve(app, (info) => {
  console.log(`Listening on http://localhost:${info.port}`);
});

export default app;
