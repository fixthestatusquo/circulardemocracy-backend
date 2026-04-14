import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { createClient } from "@supabase/supabase-js";
import { authMiddleware } from "./auth";
import type { DatabaseClient } from "./database";

// Define types for env and app
interface Env {
  SUPABASE_URL: string;
  SUPABASE_KEY: string;
}

interface Variables {
  db: DatabaseClient;
}

const app = new OpenAPIHono<{ Bindings: Env; Variables: Variables }>();

// Apply auth middleware to all routes in this file
app.use("/api/v1/messages/analytics", authMiddleware);

// =============================================================================
// SCHEMAS
// =============================================================================

const MessageAnalyticsItemSchema = z.object({
  date: z.string().datetime(),
  campaign_id: z.number(),
  campaign_name: z.string(),
  message_count: z.number(),
});

const MessageAnalyticsResponseSchema = z.object({
  analytics: z.array(MessageAnalyticsItemSchema),
});

const ErrorResponseSchema = z.object({
  success: z.boolean().default(false),
  error: z.string(),
});

// =============================================================================
// ROUTES
// =============================================================================

// Get Message Analytics
const getMessageAnalyticsRoute = createRoute({
  method: "get",
  path: "/api/v1/messages/analytics",
  security: [{ Bearer: [] }],
  request: {
    query: z.object({
      days: z.string().regex(/^\d+$/).optional().default("7").describe("Number of days to look back (default: 7)"),
    }),
  },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: MessageAnalyticsResponseSchema,
        },
      },
      description: "Message analytics grouped by day and campaign",
    },
    500: {
      content: {
        "application/json": {
          schema: ErrorResponseSchema,
        },
      },
      description: "Internal server error",
    },
  },
  tags: ["Analytics"],
  summary: "/api/v1/messages/analytics",
  description: "Retrieve message analytics showing daily message counts grouped by campaign for the last N days (default: 7 days)",
});

app.openapi(getMessageAnalyticsRoute, async (c) => {
  try {
    const { days } = c.req.valid("query");
    const daysBack = parseInt(days, 10);
    const authHeader = c.req.header("Authorization");
    const supabaseUrl = process.env.SUPABASE_URL || c.env.SUPABASE_URL;
    const supabaseAnonKey = process.env.SUPABASE_ANON_KEY || c.env.SUPABASE_KEY;
    const fromDate = new Date();
    fromDate.setDate(fromDate.getDate() - daysBack);

    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: {
        headers: authHeader ? { Authorization: authHeader } : {},
      },
      auth: {
        persistSession: false,
      },
    });

    const { data: analytics, error } = await supabase
      .from("message_analytics_view")
      .select("date, campaign_id, campaign_name, message_count")
      .gte("date", fromDate.toISOString())
      .order("date", { ascending: true });

    if (error) {
      throw error;
    }

    return c.json({ analytics: analytics ?? [] });
  } catch (error) {
    console.error("Error fetching message analytics:", error);
    return c.json(
      {
        success: false,
        error: "Failed to fetch message analytics",
      },
      500,
    );
  }
});

export default app;
