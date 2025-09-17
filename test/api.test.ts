import { describe, it, expect, vi, beforeEach, type MockedFunction } from 'vitest'
import app from '../src/api'

// Mock fetch globally is in setup.ts, but we need to cast it for typing
global.fetch = vi.fn()
const mockFetch = fetch as MockedFunction<typeof fetch>

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
      // Order of mocks now matches the order of calls in api.ts

      // 1. checkExternalIdExists -> not a duplicate
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => []
      } as Response)

      // 2. findPoliticianByEmail -> finds a politician on the first try
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => [{ id: 1, name: 'John Politician' }]
      } as Response)

      // 3. classifyMessage (with hint) -> findCampaignByHint finds a campaign
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => [{ id: 1, name: 'Climate Action', status: 'active' }]
      } as Response)

      // 4. getDuplicateRank -> no duplicates found
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => [{ count: 0 }]
      } as Response)

      // 5. insertMessage -> successfully inserts and returns ID
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
      // 1. checkExternalIdExists -> not a duplicate
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => []
      } as Response)

      // 2. findPoliticianByEmail (exact match) -> not found
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => []
      } as Response)

      // 3. findPoliticianByEmail (additional email match) -> not found
      mockFetch.mockResolvedValueOnce({
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
      // 1. checkExternalIdExists -> DUPLICATE FOUND
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => [{ id: 1 }]
      } as Response)

      // No more mocks are needed as the function should return immediately

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