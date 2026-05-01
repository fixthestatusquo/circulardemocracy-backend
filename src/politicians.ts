import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import {
  authMiddleware,
  canAccessPoliticianId,
  type AuthContext,
  requireAppRole,
} from "./auth";
import type { DatabaseClient } from "./database";

// Define types for env and app
interface Env {
  SUPABASE_URL: string;
  SUPABASE_KEY: string;
}

interface Variables {
  db: DatabaseClient;
  auth: AuthContext;
}

const app = new OpenAPIHono<{ Bindings: Env; Variables: Variables }>();

// Apply auth middleware to all routes in this file
app.use("/api/v1/politicians/*", authMiddleware);
app.use("/api/v1/politicians/*", requireAppRole("politician", "staff", "admin"));

// =============================================================================
// SCHEMAS
// =============================================================================

const PoliticianSchema = z.object({
  id: z.number(),
  name: z.string(),
  email: z.string().email(),
  party: z.string().nullable(),
  country: z.string().nullable(),
  region: z.string().nullable(),
  position: z.string().nullable(),
  active: z.boolean(),
});

// =============================================================================
// ROUTES
// =============================================================================

// List Politicians
const listPoliticiansRoute = createRoute({
  method: "get",
  path: "/api/v1/politicians",
  security: [{ Bearer: [] }],
  responses: {
    200: {
      content: { "application/json": { schema: z.array(PoliticianSchema) } },
      description: "A list of politicians",
    },
  },
  tags: ["Politicians"],
});

app.openapi(listPoliticiansRoute, async (c) => {
  const db = c.get("db") as DatabaseClient;
  const auth = c.get("auth") as AuthContext;
  let data: any[];
  if (auth.role === "admin") {
    data = await db.request<any[]>(
      "/politicians?select=id,name,email,party,country,region,position,active",
    );
  } else if (auth.politicianIds.length > 0) {
    const idList = auth.politicianIds.join(",");
    data = await db.request<any[]>(
      `/politicians?id=in.(${idList})&select=id,name,email,party,country,region,position,active`,
    );
  } else {
    data = [];
  }
  return c.json(data);
});

// Get Single Politician
const getPoliticianRoute = createRoute({
  method: "get",
  path: "/api/v1/politicians/{id}",
  security: [{ Bearer: [] }],
  request: {
    params: z.object({ id: z.string().regex(/^\\d+$/) }),
  },
  responses: {
    200: {
      content: { "application/json": { schema: PoliticianSchema } },
      description: "A single politician",
    },
    404: { description: "Politician not found" },
  },
  tags: ["Politicians"],
});

app.openapi(getPoliticianRoute, async (c) => {
  const db = c.get("db") as DatabaseClient;
  const auth = c.get("auth") as AuthContext;
  const { id } = c.req.valid("param");
  const politicianId = Number.parseInt(id, 10);
  if (!canAccessPoliticianId(auth, politicianId)) {
    return c.json({ error: "Forbidden" }, 403);
  }
  const data = await db.request<any[]>(
    `/politicians?id=eq.${id}&select=id,name,email,party,country,region,position,active&limit=1`,
  );
  if (!data || data.length === 0) {
    return c.json({ error: "Not found" }, 404);
  }
  return c.json(data[0]);
});

export default app;
