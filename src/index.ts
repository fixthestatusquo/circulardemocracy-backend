import { Hono } from "hono";
import { cors } from "hono/cors";
import apiApp from "./api";
import { type AuthEnv, apiKeyAuthMiddleware } from "./auth_middleware";
import stalwartApp from "./stalwart";

// Combine Envs if necessary, or just use a generic Env that includes API_KEY
interface Env extends AuthEnv {
  // Add other env vars if needed at the top level,
  // but usually sub-apps handle their own specific env types.
}

const app = new Hono<{ Bindings: Env }>();

// Global CORS middleware - must be applied before any other middleware
const resolveCorsOrigin = (origin: string | undefined) => {
  if (!origin) return undefined;
  try {
    const url = new URL(origin);
    if (url.hostname === "localhost" || url.hostname === "127.0.0.1") return origin;
    if (
      url.hostname === "circulardemocracy.org" ||
      url.hostname.endsWith(".circulardemocracy.org")
    ) {
      return origin;
    }
    return undefined;
  } catch {
    return undefined;
  }
};

app.use(
  "*",
  cors({
    origin: (origin) => resolveCorsOrigin(origin),
    allowHeaders: ["Content-Type", "Authorization"],
    allowMethods: ["POST", "GET", "OPTIONS", "PUT", "DELETE"],
  }),
);

// Global middleware for API key authentication on specific routes (excluding those that use Supabase auth)
app.use("/stalwart/*", apiKeyAuthMiddleware);

// Mount the stalwart app under the /stalwart route
app.route("/stalwart", stalwartApp);

// Mount the main API app at the root
app.route("/", apiApp);

export default app;
