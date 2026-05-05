import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import {
  authMiddleware,
  canAccessPoliticianId,
  type AuthContext,
  requireAppRole,
} from "./auth";
import type { DatabaseClient } from "./database";
import {
  type MailSendBindings,
  processReplyImmediately,
} from "./reply_worker";
import { calculateReplySchedule } from "./scheduling";

// Define types for env and app
interface Env extends MailSendBindings {
  SUPABASE_URL: string;
  SUPABASE_KEY: string;
}

interface Variables {
  db: DatabaseClient;
  auth: AuthContext;
}

const app = new OpenAPIHono<{ Bindings: Env; Variables: Variables }>();

// Apply auth middleware to all routes in this file
app.use("/api/v1/campaigns/*", authMiddleware);
app.use("/api/v1/campaigns/*", requireAppRole("politician", "staff", "admin"));

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
    500: {
      content: {
        "application/json": {
          schema: z.object({
            success: z.boolean(),
            error: z.string(),
          }),
        },
      },
      description: "Failed to fetch statistics",
    },
  },
  tags: ["Campaigns", "Statistics"], // Added Campaigns tag
  summary: "/api/v1/campaigns/stats",
});

app.openapi(statsRoute, async (c) => {
  const db = c.get("db") as DatabaseClient;
  try {
    const stats = await db.request<
      Array<{
        id: number;
        name: string;
        message_count: number;
        recent_count: number;
        avg_confidence?: number;
      }>
    >("/rpc/get_campaign_stats");
    return c.json({ campaigns: stats }, 200);
  } catch (_error) {
    return c.json({ success: false, error: "Failed to fetch statistics" }, 500);
  }
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
            recipient_count: z.number().optional(),
            messages_created: z.number(),
            failures: z.number(),
            replies_sent: z.number(),
            replies_failed: z.number(),
            jmap_ready: z.boolean(),
            first_send_error: z.string().optional(),
          }),
        },
      },
      description:
        "Creates broadcast reply rows and sends immediately when JMAP is configured; otherwise leaves messages pending for the scheduled worker.",
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
  const auth = c.get("auth") as AuthContext;
  const { id } = c.req.valid("param");
  const campaignId = Number.parseInt(id, 10);
  const activeTemplate = await db.getActiveTemplateForCampaign(campaignId);

  if (!activeTemplate) {
    return c.json(
      {
        success: false,
        campaign_id: campaignId,
        supporter_count: 0,
        recipient_count: 0,
        messages_created: 0,
        failures: 0,
        error: "No active reply template found for this campaign",
      },
      400,
    );
  }

  const replySchedule = calculateReplySchedule(
    activeTemplate.send_timing as "immediate" | "office_hours" | "scheduled",
    activeTemplate.scheduled_for,
  );

  const supporterRows = await db.getSupportersForCampaign(campaignId);

  // Build broadcast recipients from long-term supporter hashes + short-term contacts
  const recipients = await db.getCampaignBroadcastRecipients(campaignId);
  if (auth.role !== "admin") {
    for (const row of recipients) {
      if (!canAccessPoliticianId(auth, row.politician_id)) {
        return c.json(
          {
            success: false,
            campaign_id: campaignId,
            supporter_count: supporterRows.length,
            recipient_count: recipients.length,
            messages_created: 0,
            failures: 0,
            error:
              "Forbidden: broadcast includes supporters outside your assigned politician scope",
          },
          403,
        );
      }
    }
  }
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
  const createdMessageIds: number[] = [];

  for (const recipient of recipients) {
    try {
      const messageId = await db.createBroadcastMessageForSupporter({
        campaignId,
        politicianId: recipient.politician_id,
        senderHash: recipient.sender_hash,
        replyStatus: replySchedule.reply_status,
        replyScheduledAt: replySchedule.reply_scheduled_at,
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
      createdMessageIds.push(messageId);
    } catch (error) {
      console.error(
        "Failed to create broadcast message for supporter:",
        recipient.sender_hash,
      );
      failures++;
    }
  }

  let repliesSent = 0;
  let repliesFailed = 0;
  let firstSendError: string | undefined;

  const runtimeSecrets =
    c.env as unknown as Record<string, string | undefined>;
  const immediateAttempted =
    replySchedule.send_immediately && createdMessageIds.length > 0;
  if (immediateAttempted) {
    for (const messageId of createdMessageIds) {
      try {
        await processReplyImmediately(
          db,
          messageId,
          runtimeSecrets,
        );
        repliesSent++;
      } catch (error) {
        repliesFailed++;
        if (!firstSendError) {
          firstSendError =
            error instanceof Error ? error.message : String(error);
        }
        console.error(
          "Broadcast JMAP send failed for message",
          messageId,
        );
      }
    }
  }

  const sendOk = !immediateAttempted || repliesFailed === 0;

  return c.json({
    success: failures === 0 && sendOk,
    campaign_id: campaignId,
    supporter_count: supporterRows.length,
    recipient_count: recipients.length,
    messages_created: messagesCreated,
    failures,
    replies_sent: repliesSent,
    replies_failed: repliesFailed,
    jmap_ready: immediateAttempted,
    ...(firstSendError ? { first_send_error: firstSendError } : {}),
  });
});
