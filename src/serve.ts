import { serve } from '@hono/node-server'
import app from './index.ts'
serve({ fetch: app.fetch, port: 3000 }, () => {
  console.log('Server running on http://localhost:3000')
})

export default app
