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
app.use("/api/v1/reply-templates/*", authMiddleware);

// =============================================================================
// SCHEMAS
// =============================================================================

const ReplyTemplateSchema = z.object({
  id: z.number(),
  politician_id: z.number(),
  campaign_id: z.number(),
  name: z.string(),
  subject: z.string(),
  body: z.string(),
  active: z.boolean(),
});

const CreateReplyTemplateSchema = z.object({
  politician_id: z.number(),
  campaign_id: z.number(),
  name: z.string(),
  subject: z.string(),
  body: z.string(),
});

// =============================================================================
// ROUTES
// =============================================================================

// List Reply Templates
const listReplyTemplatesRoute = createRoute({
  method: "get",
  path: "/api/v1/reply-templates",
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

  // Get raw query parameters
  const rawQuery = c.req.query();

  // Use the Supabase client directly for better query support
  const supabase = db.getSupabaseClient();
  let supabaseQuery = supabase.from("reply_templates").select("*");

  // Filter by campaign_id if provided
  if (rawQuery?.campaign_id) {
    const campaignId = parseInt(rawQuery.campaign_id as string);
    if (!isNaN(campaignId)) {
      supabaseQuery = supabaseQuery.eq("campaign_id", campaignId);
    } else {
      console.error('Invalid campaign_id:', rawQuery.campaign_id);
      return c.json({ error: `Invalid campaign_id format: ${rawQuery.campaign_id}` }, 400);
    }
  }

  const { data, error } = await supabaseQuery;

  if (error) {
    console.error("Database error:", error);
    return c.json({ error: error.message }, 400);
  }

  return c.json(data || []);
});

// Get Single Reply Template
const getReplyTemplateRoute = createRoute({
  method: "get",
  path: "/api/v1/reply-templates/{id}",
  security: [{ Bearer: [] }],
  request: {
    params: z.object({ id: z.string().min(1) }),
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

  // Parse and validate the id
  const parsedId = parseInt(id);
  if (isNaN(parsedId)) {
    console.error('Invalid ID provided:', id);
    return c.json({ error: `Invalid ID format: ${id}` }, 400);
  }

  // Use the Supabase client directly for better query support
  const supabase = db.getSupabaseClient();
  const { data, error } = await supabase
    .from("reply_templates")
    .select("*")
    .eq("id", parsedId)
    .single();

  if (error) {
    console.error("Database error:", error);
    return c.json({ error: error.message }, 400);
  }

  if (!data) {
    return c.json({ error: "Not found" }, 404);
  }

  return c.json(data);
});

// Create Reply Template
const createReplyTemplateRoute = createRoute({
  method: "post",
  path: "/api/v1/reply-templates",
  security: [{ Bearer: [] }],
  request: {
    body: {
      content: { "application/json": { schema: CreateReplyTemplateSchema } },
    },
  },
  responses: {
    201: {
      content: { "application/json": { schema: ReplyTemplateSchema } },
      description: "The created reply template",
    },
  },
  tags: ["Reply Templates"],
});

app.openapi(createReplyTemplateRoute, async (c) => {
  const db = c.get("db") as DatabaseClient;
  const templateData = c.req.valid("json");

  // Use the Supabase client directly for POST operations
  const supabase = db.getSupabaseClient();
  const { data, error } = await supabase
    .from("reply_templates")
    .insert(templateData)
    .select()
    .single();

  if (error) {
    console.error("Database error:", error);
    return c.json({ error: error.message }, 400);
  }

  if (!data) {
    return c.json({ error: "Failed to create template" }, 500);
  }

  return c.json(data, 201);
});

// Update Reply Template
const updateReplyTemplateRoute = createRoute({
  method: "put",
  path: "/api/v1/reply-templates/{id}",
  security: [{ Bearer: [] }],
  request: {
    params: z.object({ id: z.string().min(1) }),
    body: {
      content: { "application/json": { schema: CreateReplyTemplateSchema.partial() } },
    },
  },
  responses: {
    200: {
      content: { "application/json": { schema: ReplyTemplateSchema } },
      description: "The updated reply template",
    },
    404: { description: "Reply template not found" },
  },
  tags: ["Reply Templates"],
});

app.openapi(updateReplyTemplateRoute, async (c) => {
  const db = c.get("db") as DatabaseClient;
  const { id } = c.req.valid("param");
  const updateData = c.req.valid("json");

  // Parse and validate the id
  const parsedId = parseInt(id);
  if (isNaN(parsedId)) {
    console.error('Invalid ID provided:', id);
    return c.json({ error: `Invalid ID format: ${id}` }, 400);
  }

  // Use the Supabase client directly for PUT operations
  const supabase = db.getSupabaseClient();
  const { data, error } = await supabase
    .from("reply_templates")
    .update(updateData)
    .eq("id", parsedId)
    .select()
    .single();

  if (error) {
    console.error("Database error:", error);
    return c.json({ error: error.message }, 400);
  }

  if (!data) {
    return c.json({ error: "Template not found" }, 404);
  }

  return c.json(data, 200);
});

export default app;
