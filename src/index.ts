
import { Hono } from 'hono'
import apiApp from './api'
import stalwartApp from './stalwart'

const app = new Hono()

// Mount the stalwart app under the /stalwart route
app.route('/stalwart', stalwartApp)

// Mount the main API app at the root
app.route('/', apiApp)

export default app
