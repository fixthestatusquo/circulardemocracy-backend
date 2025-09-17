// test/database.test.ts
import { describe, it, expect, vi, beforeEach, type MockedFunction } from 'vitest'
import { DatabaseClient, hashEmail } from '../src/database'

// Mock fetch globally
global.fetch = vi.fn()

describe('DatabaseClient', () => {
  let db: DatabaseClient
  const mockFetch = fetch as MockedFunction<typeof fetch>

  beforeEach(() => {
    db = new DatabaseClient({
      url: 'https://test.supabase.co',
      key: 'test-key'
    })
    mockFetch.mockClear()
  })

  describe('findPoliticianByEmail', () => {
    it('should find politician by exact email match', async () => {
      const mockPolitician = {
        id: 1,
        name: 'John Doe',
        email: 'john@example.com',
        additional_emails: []
      }

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => [mockPolitician]
      } as Response)

      const result = await db.findPoliticianByEmail('john@example.com')

      expect(result).toEqual(mockPolitician)
      expect(mockFetch).toHaveBeenCalledWith(
        'https://test.supabase.co/rest/v1/politicians?email=eq.john%40example.com&active=eq.true&select=id,name,email,additional_emails',
        expect.objectContaining({
          headers: expect.objectContaining({
            'apikey': 'test-key',
            'Authorization': 'Bearer test-key'
          })
        })
      )
    })

    it('should return null when politician not found', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => []
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => []
        } as Response)

      const result = await db.findPoliticianByEmail('notfound@example.com')

      expect(result).toBeNull()
    })

    it('should handle fetch errors gracefully', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'))

      const result = await db.findPoliticianByEmail('error@example.com')

      expect(result).toBeNull()
    })
  })

  describe('classifyMessage', () => {
    const mockEmbedding = new Array(1024).fill(0.1)

    it('should use campaign hint when provided and found', async () => {
      const mockCampaign = {
        id: 1,
        name: 'Climate Action',
        slug: 'climate-action',
        status: 'active'
      }

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => [mockCampaign]
      } as Response)

      const result = await db.classifyMessage(mockEmbedding, 'climate')

      expect(result).toEqual({
        campaign_id: 1,
        campaign_name: 'Climate Action',
        confidence: 0.95
      })
    })

    it('should fall back to vector similarity when hint not found', async () => {
      const mockSimilarCampaign = {
        id: 2,
        name: 'Environmental Policy',
        slug: 'environmental-policy',
        status: 'active',
        similarity: 0.8
      }

      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => [] // No hint match
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => [mockSimilarCampaign]
        } as Response)

      const result = await db.classifyMessage(mockEmbedding, 'nonexistent')

      expect(result).toEqual({
        campaign_id: 2,
        campaign_name: 'Environmental Policy',
        confidence: 0.8
      })
    })

    it('should use uncategorized when no good matches found', async () => {
      const mockUncategorized = {
        id: 999,
        name: 'Uncategorized',
        slug: 'uncategorized',
        status: 'active'
      }

      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => [] // No hint match
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => [] // No similar campaigns
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => [mockUncategorized] // Found uncategorized
        } as Response)

      const result = await db.classifyMessage(mockEmbedding)

      expect(result).toEqual({
        campaign_id: 999,
        campaign_name: 'Uncategorized',
        confidence: 0.1
      })
    })
  })

  describe('getDuplicateRank', () => {
    it('should return correct duplicate count', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => [{ count: 3 }]
      } as Response)

      const result = await db.getDuplicateRank('hash123', 1, 2)

      expect(result).toBe(3)
    })

    it('should return 0 when no duplicates found', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => [{ count: 0 }]
      } as Response)

      const result = await db.getDuplicateRank('hash123', 1, 2)

      expect(result).toBe(0)
    })
  })

  describe('insertMessage', () => {
    it('should insert message and return ID', async () => {
      const mockMessage = {
        external_id: 'msg123',
        channel: 'api',
        channel_source: 'test',
        politician_id: 1,
        sender_hash: 'hash123',
        campaign_id: 1,
        classification_confidence: 0.8,
        message_embedding: [0.1, 0.2, 0.3],
        language: 'en',
        received_at: '2024-01-01T00:00:00Z',
        duplicate_rank: 0,
        processing_status: 'processed'
      }

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => [{ id: 42 }]
      } as Response)

      const result = await db.insertMessage(mockMessage)

      expect(result).toBe(42)
    })
  })
})

// test/utils.test.ts
describe('Utility Functions', () => {
  describe('hashEmail', () => {
    it('should hash email consistently', async () => {
      const email = 'test@example.com'
      const hash1 = await hashEmail(email)
      const hash2 = await hashEmail(email)

      expect(hash1).toBe(hash2)
      expect(hash1).toHaveLength(64) // SHA-256 hex string
    })

    it('should normalize email case', async () => {
      const hash1 = await hashEmail('Test@Example.Com')
      const hash2 = await hashEmail('test@example.com')

      expect(hash1).toBe(hash2)
    })

    it('should trim whitespace', async () => {
      const hash1 = await hashEmail('  test@example.com  ')
      const hash2 = await hashEmail('test@example.com')

      expect(hash1).toBe(hash2)
    })
  })
})

// test/api.test.ts
import app from '../src/index'

describe('API Routes', () => {
  const env = {
    AI: {
      run: vi.fn()
    },
    SUPABASE_URL: 'https://test.supabase.co',
    SUPABASE_KEY: 'test-key'
  }

  beforeEach(() => {
    mockFetch.mockClear()
    env.AI.run.mockClear()
  })

  describe('POST /api/v1/messages', () => {
    const validMessage = {
      external_id: 'msg123',
      sender_name: 'Jane Doe',
      sender_email: 'jane@example.com',
      recipient_email: 'politician@example.com',
      subject: 'Climate Action Needed',
      message: 'We need immediate action on climate change to protect our future.',
      timestamp: '2024-01-01T10:00:00Z',
      channel_source: 'test',
      campaign_hint: 'climate'
    }

    it('should process valid message successfully', async () => {
      // Mock politician found
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => [{ id: 1, name: 'John Politician' }]
      } as Response)

      // Mock no duplicate external_id
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => []
      } as Response)

      // Mock campaign hint found
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => [{ id: 1, name: 'Climate Action', status: 'active' }]
      } as Response)

      // Mock duplicate rank
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => [{ count: 0 }]
      } as Response)

      // Mock message insert
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => [{ id: 42 }]
      } as Response)

      // Mock AI embedding
      env.AI.run.mockResolvedValueOnce({
        data: [new Array(1024).fill(0.1)]
      })

      const req = new Request('http://localhost/api/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(validMessage)
      })

      const res = await app.fetch(req, env)
      const data = await res.json()

      expect(res.status).toBe(200)
      expect(data.success).toBe(true)
      expect(data.message_id).toBe(42)
      expect(data.campaign_name).toBe('Climate Action')
    })

    it('should return 404 when politician not found', async () => {
      // Mock no politician found
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => []
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => []
        } as Response)

      const req = new Request('http://localhost/api/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(validMessage)
      })

      const res = await app.fetch(req, env)
      const data = await res.json()

      expect(res.status).toBe(404)
      expect(data.success).toBe(false)
      expect(data.status).toBe('politician_not_found')
    })

    it('should return 409 for duplicate external_id', async () => {
      // Mock duplicate external_id found
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => [{ id: 1 }]
      } as Response)

      const req = new Request('http://localhost/api/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(validMessage)
      })

      const res = await app.fetch(req, env)
      const data = await res.json()

      expect(res.status).toBe(409)
      expect(data.success).toBe(false)
      expect(data.status).toBe('duplicate')
    })

    it('should validate input schema', async () => {
      const invalidMessage = {
        external_id: '',
        sender_email: 'invalid-email',
        message: 'too short'
      }

      const req = new Request('http://localhost/api/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(invalidMessage)
      })

      const res = await app.fetch(req, env)

      expect(res.status).toBe(400)
    })
  })

  describe('GET /health', () => {
    it('should return health status', async () => {
      const req = new Request('http://localhost/health')
      const res = await app.fetch(req, env)
      const data = await res.json()

      expect(res.status).toBe(200)
      expect(data.status).toBe('ok')
      expect(data.timestamp).toBeDefined()
    })
  })
})
