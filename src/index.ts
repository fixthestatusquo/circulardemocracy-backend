import { Hono } from "hono";
import apiApp from "./api";
import { type AuthEnv, apiKeyAuthMiddleware } from "./auth_middleware";
import stalwartApp from "./stalwart";

// Combine Envs if necessary, or just use a generic Env that includes API_KEY
interface Env extends AuthEnv {
  // Add other env vars if needed at the top level,
  // but usually sub-apps handle their own specific env types.
}

const app = new Hono<{ Bindings: Env }>();

// Global middleware for API key authentication on specific routes
app.use("*", apiKeyAuthMiddleware);

// Mount the stalwart app under the /stalwart route
app.route("/stalwart", stalwartApp);

// Mount the main API app at the root
app.route("/", apiApp);

export default app;
