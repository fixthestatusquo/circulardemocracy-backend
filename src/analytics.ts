import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
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
  hour: z.string().datetime(),
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
      description: "Message analytics grouped by hour and campaign",
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
  const db = c.get("db") as DatabaseClient;

  try {
    const { days } = c.req.valid("query");
    const daysBack = parseInt(days, 10);

    // Get hourly data from database
    const hourlyAnalytics = await db.getMessageAnalytics(daysBack);

    // Aggregate hourly data to daily in the API layer
    const dailyMap = new Map<string, Map<string, { campaign_id: number; count: number }>>();

    hourlyAnalytics.forEach(item => {
      // Extract date from hour timestamp
      const date = item.hour.split('T')[0] || item.hour.split(' ')[0];

      if (!dailyMap.has(date)) {
        dailyMap.set(date, new Map());
      }

      const dayData = dailyMap.get(date)!;
      const existing = dayData.get(item.campaign_name);

      if (existing) {
        existing.count += item.message_count;
      } else {
        dayData.set(item.campaign_name, {
          campaign_id: item.campaign_id,
          count: item.message_count
        });
      }
    });

    // Convert to array format for response
    const analytics = Array.from(dailyMap.entries())
      .flatMap(([date, campaigns]) =>
        Array.from(campaigns.entries()).map(([campaign_name, data]) => ({
          date,
          campaign_id: data.campaign_id,
          campaign_name,
          message_count: data.count
        }))
      )
      .sort((a, b) => a.date.localeCompare(b.date));

    return c.json({ analytics });
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
