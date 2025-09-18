import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'
import { DatabaseClient } from './database'
import { authMiddleware } from './auth'

// Define types for env and app
interface Env {
  SUPABASE_URL: string
  SUPABASE_KEY: string
}

const app = new OpenAPIHono<{ Bindings: Env }>()

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
})

const CreateReplyTemplateSchema = z.object({
  politician_id: z.number(),
  campaign_id: z.number(),
  name: z.string(),
  subject: z.string(),
  body: z.string(),
})

// =============================================================================
// ROUTES
// =============================================================================

// List Reply Templates
const listReplyTemplatesRoute = createRoute({
  method: 'get',
  path: '/api/v1/reply-templates',
  security: [{ Bearer: [] }],
  responses: {
    200: {
      content: { 'application/json': { schema: z.array(ReplyTemplateSchema) } },
      description: 'A list of reply templates',
    },
  },
  tags: ['Reply Templates'],
})

app.openapi(listReplyTemplatesRoute, authMiddleware, async c => {
  const db = c.get('db') as DatabaseClient
  const data = await db.request<any[]>('/reply_templates?select=*')
  return c.json(data)
})

// Get Single Reply Template
const getReplyTemplateRoute = createRoute({
  method: 'get',
  path: '/api/v1/reply-templates/{id}',
  security: [{ Bearer: [] }],
  request: {
    params: z.object({ id: z.string().regex(/^\\d+$/) }),
  },
  responses: {
    200: {
      content: { 'application/json': { schema: ReplyTemplateSchema } },
      description: 'A single reply template',
    },
    404: { description: 'Reply template not found' },
  },
  tags: ['Reply Templates'],
})

app.openapi(getReplyTemplateRoute, authMiddleware, async c => {
  const db = c.get('db') as DatabaseClient
  const { id } = c.req.valid('param')
  const data = await db.request<any[]>(
    `/reply_templates?id=eq.${id}&select=*&limit=1`
  )
  if (!data || data.length === 0) {
    return c.json({ error: 'Not found' }, 404)
  }
  return c.json(data[0])
})

// Create Reply Template
const createReplyTemplateRoute = createRoute({
  method: 'post',
  path: '/api/v1/reply-templates',
  security: [{ Bearer: [] }],
  request: {
    body: { content: { 'application/json': { schema: CreateReplyTemplateSchema } } },
  },
  responses: {
    201: {
      content: { 'application/json': { schema: ReplyTemplateSchema } },
      description: 'The created reply template',
    },
  },
  tags: ['Reply Templates'],
})

app.openapi(createReplyTemplateRoute, authMiddleware, async c => {
  const db = c.get('db') as DatabaseClient
  const templateData = c.req.valid('json')
  const data = await db.request<any[]>('/reply_templates', {
    method: 'POST',
    body: JSON.stringify(templateData),
  })
  return c.json(data[0], 201)
})

export default app