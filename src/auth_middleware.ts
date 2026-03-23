import { bearerAuth } from "hono/bearer-auth";
import type { Context, Next } from "hono";

export interface AuthEnv {
  API_KEY: string;
}

export const apiKeyAuthMiddleware = async (
  c: Context<{ Bindings: AuthEnv }>,
  next: Next,
) => {
  if (c.req.method === "OPTIONS") {
    await next();
    return;
  }
  const auth = bearerAuth({ token: c.env.API_KEY });
  await auth(c, next);
};
