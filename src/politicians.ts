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

const PoliticianSchema = z.object({
  id: z.number(),
  name: z.string(),
  email: z.string().email(),
  party: z.string().nullable(),
  country: z.string().nullable(),
  region: z.string().nullable(),
  position: z.string().nullable(),
  active: z.boolean(),
})

// =============================================================================
// ROUTES
// =============================================================================

// List Politicians
const listPoliticiansRoute = createRoute({
  method: 'get',
  path: '/api/v1/politicians',
  security: [{ Bearer: [] }],
  responses: {
    200: {
      content: { 'application/json': { schema: z.array(PoliticianSchema) } },
      description: 'A list of politicians',
    },
  },
  tags: ['Politicians'],
})

app.openapi(listPoliticiansRoute, authMiddleware, async c => {
  const db = c.get('db') as DatabaseClient
  const data = await db.request<any[]>('/politicians?select=id,name,email,party,country,region,position,active')
  return c.json(data)
})

// Get Single Politician
const getPoliticianRoute = createRoute({
  method: 'get',
  path: '/api/v1/politicians/{id}',
  security: [{ Bearer: [] }],
  request: {
    params: z.object({ id: z.string().regex(/^\\d+$/) }),
  },
  responses: {
    200: {
      content: { 'application/json': { schema: PoliticianSchema } },
      description: 'A single politician',
    },
    404: { description: 'Politician not found' },
  },
  tags: ['Politicians'],
})

app.openapi(getPoliticianRoute, authMiddleware, async c => {
  const db = c.get('db') as DatabaseClient
  const { id } = c.req.valid('param')
  const data = await db.request<any[]>(
    `/politicians?id=eq.${id}&select=id,name,email,party,country,region,position,active&limit=1`
  )
  if (!data || data.length === 0) {
    return c.json({ error: 'Not found' }, 404)
  }
  return c.json(data[0])
})

export default app