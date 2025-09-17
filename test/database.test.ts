import { describe, it, expect, vi, beforeEach, type MockedFunction } from 'vitest'
import { DatabaseClient } from '../src/database'

// Mock fetch globally is now in setup.ts, but we need to cast it for typing
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