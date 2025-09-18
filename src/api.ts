
import { cors } from 'hono/cors'
import { OpenAPIHono } from '@hono/zod-openapi'
import { DatabaseClient } from './database'

// Import modular route handlers
import messagesApp from './messages'
import campaignsApp from './campaigns'
import politiciansApp from './politicians'
import replyTemplatesApp from './reply_templates'

// Define types for env and app
interface Env {
  AI: Ai
  SUPABASE_URL: string
  SUPABASE_KEY: string
}

const app = new OpenAPIHono<{ Bindings: Env }>()

// Shared middleware
app.use('/*', cors({
  origin: ['https://*.circulardemocracy.org', 'http://localhost:*'],
  allowHeaders: ['Content-Type', 'Authorization'],
  allowMethods: ['POST', 'GET', 'OPTIONS'],
}))

app.use('*', async (c, next) => {
  c.set('db', new DatabaseClient({ url: c.env.SUPABASE_URL, key: c.env.SUPABASE_KEY }))
  await next()
})

// Mount modular routers
app.route('/', messagesApp)
app.route('/', campaignsApp)
app.route('/', politiciansApp)
app.route('/', replyTemplatesApp)

// Health check for the entire API
app.get('/health', c => {
  return c.json({
    status: 'ok',
    service: 'main-api',
    timestamp: new Date().toISOString(),
    version: '1.0.0',
  })
})

// OpenAPI documentation for all combined routes
app.doc('/openapi.json', {
  openapi: '3.0.0',
  info: {
    version: '1.0.0',
    title: 'Circular Democracy API',
    description: 'API for processing citizen messages, managing campaigns, and more.',
  },
  servers: [
    {
      url: 'https://api.circulardemocracy.org',
      description: 'Production server',
    },
    {
      url: 'http://localhost:8787',
      description: 'Development server',
    },
  ],
})

export default app
