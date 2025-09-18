import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'
import { DatabaseClient, hashEmail, type MessageInsert } from './database'

// Define types for env and app
interface Env {
  AI: Ai // Cloudflare Workers AI
  SUPABASE_URL: string
  SUPABASE_KEY: string
}

const app = new OpenAPIHono<{ Bindings: Env }>()

// Schemas specific to message processing
const MessageInputSchema = z.object({
  external_id: z.string().min(1).max(255).describe('Unique identifier from source system'),
  sender_name: z.string().min(1).max(255).describe('Full name of the message sender'),
  sender_email: z.string().email().max(255).describe('Email address of the sender'),
  recipient_email: z.string().email().max(255).describe('Email address of the target politician'),
  subject: z.string().max(500).describe('Message subject line'),
  message: z.string().min(10).max(10000).describe('Message body content'),
  timestamp: z.string().datetime().describe('When the message was originally sent (ISO 8601)'),
  channel_source: z.string().max(100).optional().describe('Source system identifier'),
  campaign_hint: z.string().max(255).optional().describe('Optional campaign name hint from sender'),
})

const MessageResponseSchema = z.object({
  success: z.boolean(),
  message_id: z.number().optional(),
  status: z.enum(['processed', 'failed', 'politician_not_found', 'duplicate']),
  campaign_id: z.number().optional(),
  campaign_name: z.string().optional(),
  confidence: z.number().min(0).max(1).optional(),
  duplicate_rank: z.number().optional(),
  errors: z.array(z.string()).optional(),
})

const ErrorResponseSchema = z.object({
  success: z.boolean().default(false),
  error: z.string(),
  details: z.string().optional(),
})

// The message processing route definition
const messageRoute = createRoute({
  method: 'post',
  path: '/api/v1/messages',
  request: {
    body: {
      content: {
        'application/json': {
          schema: MessageInputSchema,
        },
      },
    },
  },
  responses: {
    200: {
      content: {
        'application/json': {
          schema: MessageResponseSchema,
        },
      },
      description: 'Message processed successfully',
    },
    400: {
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
      description: 'Invalid input data',
    },
    404: {
      content: {
        'application/json': {
          schema: MessageResponseSchema,
        },
      },
      description: 'Politician not found',
    },
    409: {
      content: {
        'application/json': {
          schema: MessageResponseSchema,
        },
      },
      description: 'Duplicate message',
    },
    500: {
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
      description: 'Internal server error',
    },
  },
  tags: ['Messages'],
  summary: 'Process incoming citizen message',
  description:
    'Receives a citizen message, classifies it by campaign, and stores it for politician response',
})

// The handler for the message route
app.openapi(messageRoute, async c => {
  const db = c.get('db') as DatabaseClient

  try {
    const data = c.req.valid('json')

    const isDuplicate = await db.checkExternalIdExists(
      data.external_id,
      data.channel_source || 'unknown'
    )
    if (isDuplicate) {
      return c.json(
        {
          success: false,
          status: 'duplicate',
          errors: [`Message with external_id ${data.external_id} already exists`],
        },
        409
      )
    }

    const politician = await db.findPoliticianByEmail(data.recipient_email)
    if (!politician) {
      return c.json(
        {
          success: false,
          status: 'politician_not_found',
          errors: [`No politician found for email: ${data.recipient_email}`],
        },
        404
      )
    }

    const embedding = await generateEmbedding(c.env.AI, data.message)
    const classification = await db.classifyMessage(embedding, data.campaign_hint)
    const senderHash = await hashEmail(data.sender_email)
    const duplicateRank = await db.getDuplicateRank(
      senderHash,
      politician.id,
      classification.campaign_id
    )

    const messageData: MessageInsert = {
      external_id: data.external_id,
      channel: 'api',
      channel_source: data.channel_source || 'unknown',
      politician_id: politician.id,
      sender_hash: senderHash,
      campaign_id: classification.campaign_id,
      classification_confidence: classification.confidence,
      message_embedding: embedding,
      language: 'auto',
      received_at: data.timestamp,
      duplicate_rank: duplicateRank,
      processing_status: 'processed',
    }

    const messageId = await db.insertMessage(messageData)

    return c.json({
      success: true,
      message_id: messageId,
      status: 'processed',
      campaign_id: classification.campaign_id,
      campaign_name: classification.campaign_name,
      confidence: classification.confidence,
      duplicate_rank: duplicateRank,
    })
  } catch (error) {
    console.error('Message processing error:', error)
    return c.json(
      {
        success: false,
        error: 'Internal server error',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      500
    )
  }
})

async function generateEmbedding(ai: Ai, text: string): Promise<number[]> {
  try {
    const response = await ai.run('@cf/baai/bge-m3', {
      text: text.substring(0, 8000), // Limit to avoid token limits
    })

    return response.data[0] as number[]
  } catch (error) {
    console.error('Embedding generation error:', error)
    throw new Error('Failed to generate message embedding')
  }
}

export default app