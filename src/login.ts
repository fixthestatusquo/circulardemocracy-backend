import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'
import { createClient } from '@supabase/supabase-js'

// Define types for env and app
interface Env {
  SUPABASE_URL: string
  SUPABASE_KEY: string
  SUPABASE_ANON_KEY: string
}

const app = new OpenAPIHono<{ Bindings: Env }>()

// =============================================================================
// SCHEMAS
// =============================================================================

const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string(),
})

const UserSchema = z.object({
  id: z.string(),
  email: z.string().email(),
  // Add other user fields if you need them in the response
});

const SessionSchema = z.object({
  access_token: z.string(),
  token_type: z.string(),
  expires_in: z.number(),
  expires_at: z.number(),
  refresh_token: z.string(),
  user: UserSchema,
})

// =============================================================================
// ROUTE
// =============================================================================

const loginRoute = createRoute({
  method: 'post',
  path: '/api/v1/login',
  request: {
    body: {
      content: {
        'application/json': {
          schema: LoginSchema,
        },
      },
    },
  },
  responses: {
    200: {
      content: { 'application/json': { schema: SessionSchema } },
      description: 'Successful login, returns session object',
    },
    401: {
      description: 'Unauthorized, invalid credentials',
      content: { 'application/json': { schema: z.object({ error: z.string() }) } },
    },
  },
  tags: ['Auth'],
})

app.openapi(loginRoute, async c => {
  const { email, password } = c.req.valid('json')

  //const supabase = createClient(c.env.SUPABASE_URL, c.env.SUPABASE_ANON_KEY)
  const supabase = createClient(c.env.SUPABASE_URL, c.env.SUPABASE_KEY)
  console.log(c.env.SUPABASE_URL, c.env.SUPABASE_KEY, email);

  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  })

  console.log(data, error);

  if (error) {
    return c.json({ error: error?.code || 'Invalid credentials' }, 401)
  }

  return c.json(data.session)
})

export default app
