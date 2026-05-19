import { createClient } from "@supabase/supabase-js";
import type { MiddlewareHandler } from "hono";
import { createMiddleware } from "hono/factory";
import { DatabaseClient as DatabaseClientImpl } from "./database";

export type AppRole = "politician" | "staff" | "admin";

export interface AuthContext {
  userId: string;
  email: string | null;
  role: AppRole;
  politicianIds: number[];
}

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

      const scopedDb = new DatabaseClientImpl({
        url: supabaseUrl,
        key: supabaseKey,
        accessToken: token,
      });
      c.set("db", scopedDb);

      const politicianIds = await scopedDb.getUserPoliticianIds(user.id);
      const claimRole = extractRoleClaim(user);
      const resolvedRole = resolveAppRole(claimRole, politicianIds);
      if (!resolvedRole) {
        return c.json(
          {
            error:
              "No application role mapping found for this user. Assign staff/politician scope or admin role.",
          },
          403,
        );
      }

      const auth: AuthContext = {
        userId: user.id,
        email: user.email || null,
        role: resolvedRole,
        politicianIds,
      };

      // Attach user to context for downstream use
      c.set("user", user);
      c.set("auth", auth);
      await next();
    } catch (err) {
      console.error("Auth error:", err);
      return c.json({ error: "Token verification failed" }, 401);
    }
  },
);

export const requireAppRole = (...allowedRoles: AppRole[]): MiddlewareHandler =>
  createMiddleware(async (c, next) => {
    const auth = c.get("auth") as AuthContext | undefined;
    if (!auth) {
      return c.json({ error: "Auth context missing" }, 401);
    }
    if (!allowedRoles.includes(auth.role)) {
      return c.json({ error: "Forbidden" }, 403);
    }
    await next();
  });

export function canAccessPoliticianId(
  auth: AuthContext,
  politicianId: number,
): boolean {
  if (auth.role === "admin") {
    return true;
  }
  return auth.politicianIds.includes(politicianId);
}

function extractRoleClaim(user: {
  app_metadata?: Record<string, unknown>;
  user_metadata?: Record<string, unknown>;
}): AppRole | null {
  const roleCandidates = [
    user.app_metadata?.role,
    user.user_metadata?.role,
    Array.isArray(user.app_metadata?.roles)
      ? user.app_metadata?.roles[0]
      : null,
    Array.isArray(user.user_metadata?.roles)
      ? user.user_metadata?.roles[0]
      : null,
  ];

  for (const candidate of roleCandidates) {
    const normalized = String(candidate || "")
      .trim()
      .toLowerCase();
    if (
      normalized === "admin" ||
      normalized === "staff" ||
      normalized === "politician"
    ) {
      return normalized as AppRole;
    }
  }

  return null;
}

function resolveAppRole(
  claimRole: AppRole | null,
  politicianIds: number[],
): AppRole | null {
  if (claimRole === "admin") {
    return "admin";
  }

  if (politicianIds.length > 0) {
    if (claimRole === "politician") {
      return "politician";
    }
    return "staff";
  }

  if (claimRole === "staff" || claimRole === "politician") {
    return null;
  }

  return null;
}
