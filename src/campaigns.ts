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

const CampaignSchema = z.object({
  id: z.number(),
  name: z.string(),
  slug: z.string(),
  description: z.string().nullable(),
  status: z.string(),
  created_at: z.string(),
})

const CreateCampaignSchema = z.object({
  name: z.string().min(3, 'Name must be at least 3 characters'),
  slug: z.string().min(3, 'Slug must be at least 3 characters').regex(/^[a-z0-9-]+$/, 'Slug can only contain lowercase letters, numbers, and hyphens'),
  description: z.string().optional(),
})

// =============================================================================
// ROUTES
// =============================================================================

// List Campaigns
const listCampaignsRoute = createRoute({
  method: 'get',
  path: '/api/v1/campaigns',
  security: [{ Bearer: [] }],
  responses: {
    200: {
      content: { 'application/json': { schema: z.array(CampaignSchema) } },
      description: 'A list of campaigns',
    },
  },
  tags: ['Campaigns'],
})

app.openapi(listCampaignsRoute, authMiddleware, async c => {
  const db = c.get('db') as DatabaseClient
  const data = await db.request<any[]>('/campaigns?select=*')
  return c.json(data)
})

// Get campaign statistics
const statsRoute = createRoute({
  method: 'get',
  path: '/api/v1/campaigns/stats',
  security: [{ Bearer: [] }],
  responses: {
    200: {
      content: {
        'application/json': {
          schema: z.object({
            campaigns: z.array(
              z.object({
                id: z.number(),
                name: z.string(),
                message_count: z.number(),
                recent_count: z.number(),
                avg_confidence: z.number().optional(),
              })
            ),
          }),
        },
      },
      description: 'Campaign statistics',
    },
  },
  tags: ['Campaigns', 'Statistics'], // Added Campaigns tag
  summary: 'Get campaign statistics',
})

app.openapi(statsRoute, authMiddleware, async c => {
  const db = c.get('db') as DatabaseClient
  try {
    const stats = await db.request('/rpc/get_campaign_stats')
    return c.json({ campaigns: stats })
  } catch (_error) {
    return c.json({ success: false, error: 'Failed to fetch statistics' }, 500)
  }
})

// Get Single Campaign
const getCampaignRoute = createRoute({
  method: 'get',
  path: '/api/v1/campaigns/{id}',
  security: [{ Bearer: [] }],
  request: {
    params: z.object({ id: z.string().regex(/^\d+$/) }),
  },
  responses: {
    200: {
      content: { 'application/json': { schema: CampaignSchema } },
      description: 'A single campaign',
    },
    404: { description: 'Campaign not found' },
  },
  tags: ['Campaigns'],
})

app.openapi(getCampaignRoute, authMiddleware, async c => {
  const db = c.get('db') as DatabaseClient
  const { id } = c.req.valid('param')
  const data = await db.request<any[]>(`/campaigns?id=eq.${id}&select=*&limit=1`)
  if (!data || data.length === 0) {
    return c.json({ error: 'Not found' }, 404)
  }
  return c.json(data[0])
})

// Create Campaign
const createCampaignRoute = createRoute({
  method: 'post',
  path: '/api/v1/campaigns',
  security: [{ Bearer: [] }],
  request: {
    body: { content: { 'application/json': { schema: CreateCampaignSchema } } },
  },
  responses: {
    201: {
      content: { 'application/json': { schema: CampaignSchema } },
      description: 'The created campaign',
    },
  },
  tags: ['Campaigns'],
})

app.openapi(createCampaignRoute, authMiddleware, async c => {
  const db = c.get('db') as DatabaseClient
  const campaignData = c.req.valid('json')
  const data = await db.request<any[]>('/campaigns', {
    method: 'POST',
    body: JSON.stringify(campaignData),
  })
  return c.json(data[0], 201)
})


export default app
