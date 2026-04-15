import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { createClient } from "@supabase/supabase-js";

// Define types for env and app
interface Env {
  SUPABASE_URL: string;
  SUPABASE_KEY: string;
  SUPABASE_ANON_KEY: string;
}

const app = new OpenAPIHono<{ Bindings: Env }>();

// =============================================================================
// SCHEMAS
// =============================================================================

const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string(),
});

const UserSchema = z.object({
  id: z.string(),
  email: z.string().email(),
});

const SessionSchema = z.object({
  access_token: z.string(),
  token_type: z.string(),
  expires_in: z.number(),
  expires_at: z.number(),
  refresh_token: z.string(),
  user: UserSchema,
});

// =============================================================================
// ROUTE
// =============================================================================

const loginRoute = createRoute({
  method: "post",
  path: "/api/v1/login",
  request: {
    body: {
      content: {
        "application/json": {
          schema: LoginSchema,
        },
      },
    },
  },
  responses: {
    200: {
      content: { "application/json": { schema: SessionSchema } },
      description: "Successful login, returns session object",
    },
    401: {
      description: "Unauthorized, invalid credentials",
      content: {
        "application/json": { schema: z.object({ error: z.string() }) },
      },
    },
    500: {
      description: "Invalid auth provider response",
      content: {
        "application/json": { schema: z.object({ error: z.string() }) },
      },
    },
  },
  tags: ["Auth"],
});

app.openapi(loginRoute, async (c) => {
  const { email, password } = c.req.valid("json");

  // Use process.env for Node.js development environment
  const supabase = createClient(
    process.env.SUPABASE_URL || c.env.SUPABASE_URL,
    process.env.SUPABASE_KEY || c.env.SUPABASE_KEY,
  );
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error) {
    return c.json({ error: error?.code || "Invalid credentials" }, 401);
  }

  if (!data.session) {
    return c.json({ error: "Invalid credentials" }, 401);
  }

  const userEmail = data.session.user.email;
  if (!userEmail) {
    return c.json({ error: "Session user email missing" }, 500);
  }
  const expiresAt =
    data.session.expires_at ??
    Math.floor(Date.now() / 1000) + data.session.expires_in;

  return c.json(
    {
      access_token: data.session.access_token,
      token_type: data.session.token_type,
      expires_in: data.session.expires_in,
      expires_at: expiresAt,
      refresh_token: data.session.refresh_token,
      user: {
        id: data.session.user.id,
        email: userEmail,
      },
    },
    200,
  );
});

export default app;
