import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
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
app.use("/api/v1/campaigns/*", authMiddleware);

// =============================================================================
// SCHEMAS
// =============================================================================

const CampaignSchema = z.object({
  id: z.number(),
  name: z.string(),
  slug: z.string(),
  description: z.string().nullable(),
  status: z.string(),
  created_at: z.string(),
});

const CreateCampaignSchema = z.object({
  name: z.string().min(3, "Name must be at least 3 characters"),
  slug: z
    .string()
    .min(3, "Slug must be at least 3 characters")
    .regex(
      /^[a-z0-9-]+$/,
      "Slug can only contain lowercase letters, numbers, and hyphens",
    ),
  description: z.string().optional(),
});

// =============================================================================
// ROUTES
// =============================================================================

// List Campaigns
const listCampaignsRoute = createRoute({
  method: "get",
  path: "/api/v1/campaigns",
  security: [{ Bearer: [] }],
  responses: {
    200: {
      content: { "application/json": { schema: z.array(CampaignSchema) } },
      description: "A list of campaigns",
    },
  },
  tags: ["Campaigns"],
});

app.openapi(listCampaignsRoute, async (c) => {
  const db = c.get("db") as DatabaseClient;
  const data = await db.request<any[]>("/campaigns?select=*");
  return c.json(data);
});

// Get campaign statistics
const statsRoute = createRoute({
  method: "get",
  path: "/api/v1/campaigns/stats",
  security: [{ Bearer: [] }],
  responses: {
    200: {
      content: {
        "application/json": {
          schema: z.object({
            campaigns: z.array(
              z.object({
                id: z.number(),
                name: z.string(),
                message_count: z.number(),
                recent_count: z.number(),
                avg_confidence: z.number().optional(),
              }),
            ),
          }),
        },
      },
      description: "Campaign statistics",
    },
  },
  tags: ["Campaigns", "Statistics"], // Added Campaigns tag
  summary: "/api/v1/campaigns/stats",
});

app.openapi(statsRoute, async (c) => {
  const db = c.get("db") as DatabaseClient;
  const stats = await db.request<
    Array<{
      id: number;
      name: string;
      message_count: number;
      recent_count: number;
      avg_confidence?: number;
    }>
  >("/rpc/get_campaign_stats");
  return c.json({ campaigns: stats });
});

// Get Single Campaign
const getCampaignRoute = createRoute({
  method: "get",
  path: "/api/v1/campaigns/{id}",
  security: [{ Bearer: [] }],
  request: {
    params: z.object({ id: z.string().regex(/^\d+$/) }),
  },
  responses: {
    200: {
      content: { "application/json": { schema: CampaignSchema } },
      description: "A single campaign",
    },
    404: { description: "Campaign not found" },
  },
  tags: ["Campaigns"],
});

app.openapi(getCampaignRoute, async (c) => {
  const db = c.get("db") as DatabaseClient;
  const { id } = c.req.valid("param");
  const data = await db.request<any[]>(
    `/campaigns?id=eq.${id}&select=*&limit=1`,
  );
  if (!data || data.length === 0) {
    return c.json({ error: "Not found" }, 404);
  }
  return c.json(data[0]);
});

// Create Campaign
const createCampaignRoute = createRoute({
  method: "post",
  path: "/api/v1/campaigns",
  security: [{ Bearer: [] }],
  request: {
    body: { content: { "application/json": { schema: CreateCampaignSchema } } },
  },
  responses: {
    201: {
      content: { "application/json": { schema: CampaignSchema } },
      description: "The created campaign",
    },
  },
  tags: ["Campaigns"],
});

app.openapi(createCampaignRoute, async (c) => {
  const db = c.get("db") as DatabaseClient;
  const campaignData = c.req.valid("json");
  const data = await db.request<any[]>("/campaigns", {
    method: "POST",
    body: JSON.stringify(campaignData),
  });
  return c.json(data[0], 201);
});

export default app;

// =============================================================================
// BROADCAST REPLIES
// =============================================================================

const broadcastRepliesRoute = createRoute({
  method: "post",
  path: "/api/v1/campaigns/{id}/replies/broadcast",
  security: [{ Bearer: [] }],
  request: {
    params: z.object({ id: z.string().regex(/^\d+$/) }),
  },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: z.object({
            success: z.boolean(),
            campaign_id: z.number(),
            supporter_count: z.number(),
            messages_created: z.number(),
            failures: z.number(),
          }),
        },
      },
      description:
        "Broadcast of the active reply template to all supporters was queued.",
    },
    400: {
      description: "Bad request (e.g. no active template or no supporters)",
    },
    401: { description: "Unauthorized" },
    403: { description: "Forbidden" },
  },
  tags: ["Campaigns"],
  summary: "/api/v1/campaigns/{id}/replies/broadcast",
});

app.openapi(broadcastRepliesRoute, async (c) => {
  const db = c.get("db") as DatabaseClient;
  const { id } = c.req.valid("param");
  const campaignId = Number.parseInt(id, 10);

  const supporterRows = await db.getSupportersForCampaign(campaignId);

  // Build broadcast recipients from long-term supporter hashes + short-term contacts
  const recipients = await db.getCampaignBroadcastRecipients(campaignId);
  if (recipients.length === 0) {
    const errorMessage =
      supporterRows.length === 0
        ? "No supporters found for this campaign"
        : "No short-term message contacts found for supporters; ingest new messages to capture reply contacts";
    return c.json(
      {
        success: false,
        campaign_id: campaignId,
        supporter_count: supporterRows.length,
        recipient_count: 0,
        messages_created: 0,
        failures: 0,
        error: errorMessage,
      },
      400,
    );
  }

  // We deliberately do not touch PII rules in messages:
  // messages are created without email addresses; email stays in supporters only.

  let messagesCreated = 0;
  let failures = 0;

  for (const recipient of recipients) {
    try {
      const messageId = await db.createBroadcastMessageForSupporter({
        campaignId,
        politicianId: recipient.politician_id,
        senderHash: recipient.sender_hash,
      });

      if (!messageId) {
        failures++;
        continue;
      }

      await db.storeMessageContact({
        messageId,
        senderHash: recipient.sender_hash,
        senderEmail: recipient.email,
      });

      messagesCreated++;
    } catch (error) {
      console.error(
        "Failed to create broadcast message for supporter:",
        recipient.sender_hash,
        error,
      );
      failures++;
    }
  }

  return c.json({
    success: failures === 0,
    campaign_id: campaignId,
    supporter_count: supporterRows.length,
    recipient_count: recipients.length,
    messages_created: messagesCreated,
    failures,
  });
});

