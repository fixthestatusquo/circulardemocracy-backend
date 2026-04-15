import { createClient } from "@supabase/supabase-js";
import type { MiddlewareHandler } from "hono";
import { createMiddleware } from "hono/factory";

export const authMiddleware: MiddlewareHandler = createMiddleware(
  async (c, next) => {
    const supabaseUrl = process.env.SUPABASE_URL || c.env?.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_KEY || c.env?.SUPABASE_KEY;

    if (!supabaseUrl || !supabaseKey) {
      console.error("Supabase credentials not configured");
      return c.json({ error: "Auth not configured" }, 500);
    }

    // Get the Authorization header
    const authHeader = c.req.header("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return c.json({ error: "No authorization header" }, 401);
    }

    const token = authHeader.substring(7); // Remove "Bearer " prefix

    // Create Supabase client and verify the token
    const supabase = createClient(supabaseUrl, supabaseKey);

    try {
      const {
        data: { user },
        error,
      } = await supabase.auth.getUser(token);

      if (error || !user) {
        console.error("Token verification failed:", error?.message);
        return c.json({ error: "Invalid token" }, 401);
      }

      // Attach user to context for downstream use
      c.set("user", user);
      await next();
    } catch (err) {
      console.error("Auth error:", err);
      return c.json({ error: "Token verification failed" }, 401);
    }
  },
);
