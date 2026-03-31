import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { authMiddleware } from "./auth";
import type { DatabaseClient } from "./database";
import {
  createReplyTemplate,
  updateReplyTemplate as updateTemplateService,
} from "./template_service";

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
app.use("/api/v1/reply-templates/*", authMiddleware);

// =============================================================================
// SCHEMAS
// =============================================================================

const ReplyTemplateSchema = z.object({
  id: z.number(),
  campaign_id: z.number(),
  name: z.string(),
  subject: z.string(),
  message_body: z.string().describe("Markdown formatted email body"),
  active: z.boolean(),
  layout_type: z.enum(["text_only", "standard_header"]),
  send_timing: z.enum(["immediate", "office_hours", "scheduled"]),
  scheduled_for: z.string().datetime().nullable().optional(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});

const CreateReplyTemplateSchema = z.object({
  campaign_id: z.number(),
  name: z.string().min(3, "Name must be at least 3 characters"),
  subject: z.string().min(1, "Subject is required").max(255),
  message_body: z.string().min(10, "Message body must be at least 10 characters"),
  layout_type: z.enum(["text_only", "standard_header"]).default("standard_header"),
  send_timing: z.enum(["immediate", "office_hours", "scheduled"]).default("office_hours"),
  scheduled_for: z.string().datetime().optional(),
  active: z.boolean().default(true),
});

const UpdateReplyTemplateSchema = z.object({
  name: z.string().min(3).optional(),
  subject: z.string().min(1).max(255).optional(),
  message_body: z.string().min(10).optional(),
  layout_type: z.enum(["text_only", "standard_header"]).optional(),
  send_timing: z.enum(["immediate", "office_hours", "scheduled"]).optional(),
  scheduled_for: z.string().datetime().optional(),
  active: z.boolean().optional(),
});

function toApiTemplate(template: any) {
  return {
    ...template,
    message_body: template.body,
  };
}

// =============================================================================
// ROUTES
// =============================================================================

// List Reply Templates
const listReplyTemplatesRoute = createRoute({
  method: "get",
  path: "/api/v1/reply-templates",
  summary: "/api/v1/reply-templates",
  description: "Retrieve a list of all campaign auto-reply templates. Templates define automated email responses sent to supporters.",
  security: [{ Bearer: [] }],
  responses: {
    200: {
      content: { "application/json": { schema: z.array(ReplyTemplateSchema) } },
      description: "A list of reply templates",
    },
  },
  tags: ["Reply Templates"],
});

app.openapi(listReplyTemplatesRoute, async (c) => {
  const db = c.get("db") as DatabaseClient;
  const data = await db.request<any[]>("/reply_templates?select=*");
  return c.json(data.map(toApiTemplate));
});

// Get Single Reply Template
const getReplyTemplateRoute = createRoute({
  method: "get",
  path: "/api/v1/reply-templates/{id}",
  summary: "/api/v1/reply-templates/{id}",
  description: "Retrieve detailed information about a specific campaign auto-reply template.",
  security: [{ Bearer: [] }],
  request: {
    params: z.object({ id: z.string().regex(/^\\d+$/).describe("Template ID") }),
  },
  responses: {
    200: {
      content: { "application/json": { schema: ReplyTemplateSchema } },
      description: "A single reply template",
    },
    404: { description: "Reply template not found" },
  },
  tags: ["Reply Templates"],
});

app.openapi(getReplyTemplateRoute, async (c) => {
  const db = c.get("db") as DatabaseClient;
  const { id } = c.req.valid("param");
  const data = await db.request<any[]>(
    `/reply_templates?id=eq.${id}&select=*&limit=1`,
  );
  if (!data || data.length === 0) {
    return c.json({ error: "Not found" }, 404);
  }
  return c.json(toApiTemplate(data[0]));
});

// Create Reply Template
const createReplyTemplateRoute = createRoute({
  method: "post",
  path: "/api/v1/reply-templates",
  summary: "/api/v1/reply-templates",
  description: "Create a new auto-reply template for a campaign. The template defines the email content, layout, and scheduling for automated responses to supporters. If active=true, this will deactivate other templates for the same campaign.",
  security: [{ Bearer: [] }],
  request: {
    body: {
      content: { "application/json": { schema: CreateReplyTemplateSchema } },
      description: "Reply template data including subject, message body (markdown), layout type, and send timing.",
    },
  },
  responses: {
    201: {
      content: { "application/json": { schema: ReplyTemplateSchema } },
      description: "The created reply template",
    },
    400: {
      description: "Validation failed - check request body",
    },
  },
  tags: ["Reply Templates"],
});

app.openapi(createReplyTemplateRoute, async (c) => {
  const db = c.get("db") as DatabaseClient;
  const templateDataInput = c.req.valid("json");
  const templateData = {
    ...templateDataInput,
    body: templateDataInput.message_body,
  };

  const result = await createReplyTemplate(db, templateData);

  if (!result.success) {
    return c.json(
      {
        error: "Validation failed",
        validation_errors: result.errors,
      },
      400,
    );
  }

  return c.json(toApiTemplate(result.template), 201);
});

// Update Reply Template
const updateReplyTemplateRoute = createRoute({
  method: "patch",
  path: "/api/v1/reply-templates/{id}",
  summary: "/api/v1/reply-templates/{id}",
  description: "Update an existing auto-reply template. You can modify the subject, message body, layout type, send timing, and active status. Setting active=true will deactivate other templates for the same campaign.",
  security: [{ Bearer: [] }],
  request: {
    params: z.object({ id: z.string().regex(/^\d+$/).describe("Template ID") }),
    body: {
      content: { "application/json": { schema: UpdateReplyTemplateSchema } },
      description: "Fields to update. All fields are optional.",
    },
  },
  responses: {
    200: {
      content: { "application/json": { schema: ReplyTemplateSchema } },
      description: "The updated reply template",
    },
    400: {
      description: "Validation failed - check request body",
    },
    404: { description: "Reply template not found" },
    403: { description: "Forbidden - not authorized to update this template" },
  },
  tags: ["Reply Templates"],
});

app.openapi(updateReplyTemplateRoute, async (c) => {
  const db = c.get("db") as DatabaseClient;
  const { id } = c.req.valid("param");
  const updatesInput = c.req.valid("json");
  const templateId = Number.parseInt(id);

  const updates: Record<string, unknown> = { ...updatesInput };
  if (updatesInput.message_body !== undefined) {
    updates.body = updatesInput.message_body;
    delete updates.message_body;
  }

  const result = await updateTemplateService(db, templateId, updates);

  if (!result.success) {
    const notFoundError = result.errors.find((e) => e.field === "id");
    if (notFoundError) {
      return c.json({ error: notFoundError.message }, 404);
    }

    return c.json(
      {
        error: "Validation failed",
        validation_errors: result.errors,
      },
      400,
    );
  }

  return c.json(toApiTemplate(result.template), 200);
});

// Delete Reply Template
const deleteReplyTemplateRoute = createRoute({
  method: "delete",
  path: "/api/v1/reply-templates/{id}",
  summary: "/api/v1/reply-templates/{id}",
  description: "Permanently delete an auto-reply template. This action cannot be undone.",
  security: [{ Bearer: [] }],
  request: {
    params: z.object({ id: z.string().regex(/^\d+$/).describe("Template ID") }),
  },
  responses: {
    204: { description: "Reply template deleted successfully" },
    404: { description: "Reply template not found" },
    403: { description: "Forbidden - not authorized to delete this template" },
  },
  tags: ["Reply Templates"],
});

app.openapi(deleteReplyTemplateRoute, async (c) => {
  const db = c.get("db") as DatabaseClient;
  const { id } = c.req.valid("param");
  const templateId = Number.parseInt(id);

  try {
    await db.deleteReplyTemplate(templateId);
    return c.body(null, 204);
  } catch (error) {
    console.error("Error deleting reply template:", error);
    return c.json(
      {
        error: "Failed to delete reply template",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      500,
    );
  }
});

// Activate/Deactivate Reply Template
const toggleTemplateActiveRoute = createRoute({
  method: "post",
  path: "/api/v1/reply-templates/{id}/toggle-active",
  summary: "/api/v1/reply-templates/{id}/toggle-active",
  description: "Activate or deactivate an auto-reply template. Only one template can be active per campaign. Setting active=true will automatically deactivate other templates for the same campaign.",
  security: [{ Bearer: [] }],
  request: {
    params: z.object({ id: z.string().regex(/^\d+$/).describe("Template ID") }),
    body: {
      content: {
        "application/json": {
          schema: z.object({
            active: z.boolean().describe("Set to true to activate, false to deactivate"),
          }),
        },
      },
      description: "Activation status to set",
    },
  },
  responses: {
    200: {
      content: { "application/json": { schema: ReplyTemplateSchema } },
      description: "Template activation status updated",
    },
    404: { description: "Reply template not found" },
  },
  tags: ["Reply Templates"],
});

app.openapi(toggleTemplateActiveRoute, async (c) => {
  const db = c.get("db") as DatabaseClient;
  const { id } = c.req.valid("param");
  const { active } = c.req.valid("json");
  const templateId = Number.parseInt(id);

  try {
    const existingTemplate = await db.getReplyTemplateById(templateId);
    if (!existingTemplate) {
      return c.json({ error: "Template not found" }, 404);
    }

    // If activating, deactivate other templates for this campaign
    if (active) {
      await db.deactivateOtherTemplates(
        existingTemplate.campaign_id,
        templateId,
      );
    }

    const updatedTemplate = await db.updateReplyTemplate(templateId, { active });
    return c.json(toApiTemplate(updatedTemplate), 200);
  } catch (error) {
    console.error("Error toggling template active status:", error);
    return c.json(
      {
        error: "Failed to toggle template status",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      500,
    );
  }
});

export default app;
