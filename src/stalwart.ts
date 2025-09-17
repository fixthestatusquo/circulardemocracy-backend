// src/stalwart.ts - Stalwart MTA Hook Worker
import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'
import { cors } from 'hono/cors'
import { DatabaseClient, hashEmail, type MessageInsert } from './database'

// Environment variables interface
interface Env {
  AI: Ai
  SUPABASE_URL: string
  SUPABASE_KEY: string
}

// =============================================================================
// STALWART MTA HOOK SCHEMAS
// =============================================================================

const StalwartHookSchema = z.object({
  messageId: z.string().describe('Stalwart internal message ID'),
  queueId: z.string().optional().describe('Queue ID for tracking'),
  sender: z.string().email().describe('Envelope sender'),
  recipients: z.array(z.string().email()).describe('All envelope recipients'),
  headers: z.record(z.string(), z.union([z.string(), z.array(z.string())]))
    .describe('All email headers'),
  subject: z.string().optional(),
  body: z.object({
    text: z.string().optional().describe('Plain text body'),
    html: z.string().optional().describe('HTML body')
  }).optional(),
  size: z.number().describe('Message size in bytes'),
  timestamp: z.number().describe('Unix timestamp when received'),
  spf: z.object({
    result: z.enum(['pass', 'fail', 'softfail', 'neutral', 'temperror', 'permerror', 'none']),
    domain: z.string().optional()
  }).optional(),
  dkim: z.array(z.object({
    result: z.enum(['pass', 'fail', 'temperror', 'permerror', 'neutral', 'none']),
    domain: z.string().optional(),
    selector: z.string().optional()
  })).optional(),
  dmarc: z.object({
    result: z.enum(['pass', 'fail', 'temperror', 'permerror', 'none']),
    policy: z.enum(['none', 'quarantine', 'reject']).optional()
  }).optional()
})

const StalwartResponseSchema = z.object({
  action: z.enum(['accept', 'reject', 'quarantine', 'discard']),
  modifications: z.object({
    folder: z.string().optional().describe('IMAP folder to store message'),
    headers: z.record(z.string(), z.string()).optional(),
    subject: z.string().optional()
  }).optional(),
  reject_reason: z.string().optional(),
  confidence: z.number().min(0).max(1).optional()
})

// =============================================================================
// STALWART WORKER APP
// =============================================================================

const app = new OpenAPIHono<{ Bindings: Env }>()

// CORS middleware
app.use('/*', cors({
  origin: ['https://*.circulardemocracy.org', 'http://localhost:*'],
  allowHeaders: ['Content-Type', 'Authorization'],
  allowMethods: ['POST', 'GET', 'OPTIONS'],
}))

// Database client middleware
app.use('*', async (c, next) => {
  c.set('db', new DatabaseClient({
    url: c.env.SUPABASE_URL,
    key: c.env.SUPABASE_KEY
  }))
  await next()
})

// =============================================================================
// MTA HOOK ROUTE
// =============================================================================

const mtaHookRoute = createRoute({
  method: 'post',
  path: '/mta-hook',
  request: {
    body: {
      content: {
        'application/json': {
          schema: StalwartHookSchema,
        },
      },
    },
  },
  responses: {
    200: {
      content: {
        'application/json': {
          schema: StalwartResponseSchema,
        },
      },
      description: 'Instructions for message handling',
    },
    500: {
      content: {
        'application/json': {
          schema: z.object({
            action: z.literal('accept'),
            error: z.string()
          }),
        },
      },
      description: 'Error - default to accept',
    },
  },
  tags: ['Stalwart'],
  summary: 'MTA Hook for incoming emails',
  description: 'Processes incoming emails and provides routing instructions'
})

app.openapi(mtaHookRoute, async (c) => {
  const db = c.get('db') as DatabaseClient
  
  try {
    const hookData = c.req.valid('json')
    
    console.log(`Processing email: ${hookData.messageId} from ${hookData.sender}`)
    
    // Extract actual sender from headers (considering SPF/DKIM)
    const senderEmail = extractSenderEmail(hookData)
    const senderName = extractSenderName(hookData)
    
    // Process each recipient
    const results = await Promise.all(
      hookData.recipients.map(async (recipientEmail) => {
        return await processEmailForRecipient(
          db,
          c.env.AI,
          hookData,
          senderEmail,
          senderName,
          recipientEmail
        )
      })
    )
    
    // Use the result with highest confidence
    const bestResult = results.reduce((best, current) => 
      (current.confidence || 0) > (best.confidence || 0) ? current : best
    )
    
    console.log(`Email processed: campaign=${bestResult.modifications?.headers?.['X-CircularDemocracy-Campaign']}, confidence=${bestResult.confidence}`)
    
    return c.json(bestResult)
    
  } catch (error) {
    console.error('MTA Hook processing error:', error)
    
    // Always accept on error to avoid email loss
    return c.json({
      action: 'accept',
      error: error instanceof Error ? error.message : 'Unknown error'
    }, 500)
  }
})

// Health check
app.get('/health', (c) => {
  return c.json({ 
    status: 'ok', 
    service: 'stalwart-hook',
    timestamp: new Date().toISOString() 
  })
})

// =============================================================================
// EMAIL PROCESSING LOGIC
// =============================================================================

async function processEmailForRecipient(
  db: DatabaseClient,
  ai: Ai,
  hookData: z.infer<typeof StalwartHookSchema>,
  senderEmail: string,
  senderName: string,
  recipientEmail: string
) {
  try {
    // Step 1: Check for duplicate message
    const isDuplicate = await db.checkExternalIdExists(hookData.messageId, 'stalwart')
    if (isDuplicate) {
      return {
        action: 'accept' as const,
        confidence: 1.0,
        modifications: {
          folder: 'CircularDemocracy/System/Duplicates',
          headers: { 'X-CircularDemocracy-Status': 'duplicate' }
        }
      }
    }
    
    // Step 2: Find target politician
    const politician = await db.findPoliticianByEmail(recipientEmail)
    if (!politician) {
      return {
        action: 'accept' as const,
        confidence: 0.0,
        modifications: {
          folder: 'CircularDemocracy/System/Unknown',
          headers: { 'X-CircularDemocracy-Status': 'politician-not-found' }
        }
      }
    }
    
    // Step 3: Extract and validate message content
    const messageContent = extractMessageContent(hookData)
    if (messageContent.length < 10) {
      return {
        action: 'accept' as const,
        confidence: 0.1,
        modifications: {
          folder: 'CircularDemocracy/System/TooShort',
          headers: { 'X-CircularDemocracy-Status': 'message-too-short' }
        }
      }
    }
    
    // Step 4: Generate embedding and classify
    const embedding = await generateEmbedding(ai, messageContent)
    const classification = await db.classifyMessage(embedding)
    
    // Step 5: Check for logical duplicates
    const senderHash = await hashEmail(senderEmail)
    const duplicateRank = await db.getDuplicateRank(senderHash, politician.id, classification.campaign_id)
    
    // Step 6: Store message metadata
    const messageData: MessageInsert = {
      external_id: hookData.messageId,
      channel: 'email',
      channel_source: 'stalwart',
      politician_id: politician.id,
      sender_hash: senderHash,
      campaign_id: classification.campaign_id,
      classification_confidence: classification.confidence,
      message_embedding: embedding,
      language: 'auto', // TODO: detect language
      received_at: new Date(hookData.timestamp * 1000).toISOString(),
      duplicate_rank: duplicateRank,
      processing_status: 'processed'
    }
    
    await db.insertMessage(messageData)
    
    // Step 7: Generate folder and response
    const folderName = generateFolderName(classification, duplicateRank)
    
    return {
      action: 'accept' as const,
      confidence: classification.confidence,
      modifications: {
        folder: folderName,
        headers: {
          'X-CircularDemocracy-Campaign': classification.campaign_name,
          'X-CircularDemocracy-Confidence': classification.confidence.toString(),
          'X-CircularDemocracy-Duplicate-Rank': duplicateRank.toString(),
          'X-CircularDemocracy-Message-ID': hookData.messageId,
          'X-CircularDemocracy-Politician': politician.name,
          'X-CircularDemocracy-Status': 'processed'
        }
      }
    }
    
  } catch (error) {
    console.error(`Error processing email for ${recipientEmail}:`, error)
    return {
      action: 'accept' as const,
      confidence: 0.0,
      modifications: {
        folder: 'CircularDemocracy/System/ProcessingError',
        headers: {
          'X-CircularDemocracy-Status': 'error',
          'X-CircularDemocracy-Error': error instanceof Error ? error.message : 'unknown'
        }
      }
    }
  }
}

// =============================================================================
// UTILITY FUNCTIONS
// =============================================================================

function extractSenderEmail(hookData: z.infer<typeof StalwartHookSchema>): string {
  // Priority: Reply-To > From > envelope sender (SPF considerations)
  const replyTo = getHeader(hookData.headers, 'reply-to')
  if (replyTo && isValidEmail(replyTo)) {
    return replyTo
  }
  
  const from = getHeader(hookData.headers, 'from')
  if (from) {
    const emailMatch = from.match(/<([^>]+)>/) || [null, from]
    const email = emailMatch[1]?.trim()
    if (email && isValidEmail(email)) {
      return email
    }
  }
  
  return hookData.sender
}

function extractSenderName(hookData: z.infer<typeof StalwartHookSchema>): string {
  const from = getHeader(hookData.headers, 'from')
  if (from) {
    const nameMatch = from.match(/^([^<]+)</)
    if (nameMatch) {
      return nameMatch[1].trim().replace(/^["']|["']$/g, '')
    }
  }
  
  const email = extractSenderEmail(hookData)
  return email.split('@')[0]
}

function extractMessageContent(hookData: z.infer<typeof StalwartHookSchema>): string {
  // Prefer plain text over HTML
  const textContent = hookData.body?.text
  if (textContent && textContent.trim().length > 0) {
    return cleanTextContent(textContent)
  }
  
  const htmlContent = hookData.body?.html
  if (htmlContent) {
    return cleanHtmlContent(htmlContent)
  }
  
  return hookData.subject || ''
}

function cleanTextContent(text: string): string {
  return text
    .replace(/^>.*$/gm, '') // Remove quoted lines
    .replace(/^\s*On .* wrote:\s*$/gm, '') // Remove reply headers
    .replace(/\n{3,}/g, '\n\n') // Normalize newlines
    .trim()
}

function cleanHtmlContent(html: string): string {
  return html
    .replace(/<[^>]*>/g, ' ') // Strip HTML tags
    .replace(/\s+/g, ' ') // Normalize whitespace
    .trim()
}

function getHeader(headers: Record<string, string | string[]>, name: string): string | null {
  const value = headers[name.toLowerCase()]
  return Array.isArray(value) ? value[0] || null : value || null
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
}

function generateFolderName(
  classification: { campaign_name: string; confidence: number }, 
  duplicateRank: number
): string {
  const baseFolder = 'CircularDemocracy'
  const campaignFolder = classification.campaign_name
    .replace(/[^a-zA-Z0-9\-_\s]/g, '')
    .replace(/\s+/g, '-')
    .substring(0, 50) // Limit folder name length
  
  if (duplicateRank > 0) {
    return `${baseFolder}/${campaignFolder}/Duplicates`
  }
  
  if (classification.confidence < 0.3) {
    return `${baseFolder}/${campaignFolder}/LowConfidence`
  }
  
  return `${baseFolder}/${campaignFolder}`
}

async function generateEmbedding(ai: Ai, text: string): Promise<number[]> {
  try {
    const response = await ai.run('@cf/baai/bge-m3', {
      text: text.substring(0, 8000)
    })
    
    return response.data[0] as number[]
  } catch (error) {
    console.error('Embedding generation error:', error)
    throw new Error('Failed to generate message embedding')
  }
}

// OpenAPI documentation
app.doc('/openapi.json', {
  openapi: '3.0.0',
  info: {
    version: '1.0.0',
    title: 'Stalwart MTA Hook API',
    description: 'Processes incoming emails via Stalwart mail server hooks'
  },
  servers: [
    {
      url: 'https://stalwart.circulardemocracy.org',
      description: 'Production Stalwart hook server'
    }
  ]
})

export default app
