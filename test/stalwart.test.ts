
import { describe, it, expect, vi, beforeEach, type MockedFunction } from 'vitest'
import app from '../src/stalwart' // Test the stalwart app directly

// Mock fetch globally is in setup.ts, but we need to cast it for typing
global.fetch = vi.fn()
const mockFetch = fetch as MockedFunction<typeof fetch>

describe('Stalwart API (/mta-hook)', () => {
  const env = {
    AI: {
      run: vi.fn()
    },
    SUPABASE_URL: 'https://test.supabase.co',
    SUPABASE_KEY: 'test-key'
  }

  // A valid Stalwart webhook payload
  const stalwartPayload = {
    messageId: 'stalwart-msg-123',
    sender: 'sender@example.com',
    recipients: ['politician@example.com'],
    headers: {
      from: '"Sender Name" <sender@example.com>',
      subject: 'Important Issue'
    },
    body: {
      text: 'This is a message about an important issue that needs your attention.'
    },
    size: 500,
    timestamp: Math.floor(Date.now() / 1000)
  }

  beforeEach(() => {
    mockFetch.mockClear()
    env.AI.run.mockClear()
  })

  it('should process a valid email and classify it', async () => {
    // 1. checkExternalIdExists -> not a duplicate
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => [] } as Response)
    // 2. findPoliticianByEmail -> found
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => [{ id: 1, name: 'Test Politician' }] } as Response)
    // 3. classifyMessage (no hint) -> findSimilarCampaigns -> found a match
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => [{ id: 10, name: 'Test Campaign', similarity: 0.8 }] } as Response)
    // 4. getDuplicateRank -> not a duplicate
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => [{ count: 0 }] } as Response)
    // 5. insertMessage -> success
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => [{ id: 101 }] } as Response)

    // Mock AI embedding
    env.AI.run.mockResolvedValueOnce({ data: [new Array(1024).fill(0.2)] })

    const req = new Request('http://localhost/mta-hook', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(stalwartPayload)
    })

    const res = await app.fetch(req, env)
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data.action).toBe('accept')
    expect(data.modifications.folder).toContain('Test-Campaign')
    expect(data.modifications.headers['X-CircularDemocracy-Status']).toBe('processed')
  })

  it('should handle politician not found', async () => {
    // 1. checkExternalIdExists -> not a duplicate
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => [] } as Response)
    // 2. findPoliticianByEmail (exact) -> not found
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => [] } as Response)
    // 3. findPoliticianByEmail (additional) -> not found
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => [] } as Response)

    const req = new Request('http://localhost/mta-hook', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(stalwartPayload)
    })

    const res = await app.fetch(req, env)
    const data = await res.json()

    expect(res.status).toBe(200) // The hook itself should not fail
    expect(data.action).toBe('accept')
    expect(data.modifications.folder).toBe('CircularDemocracy/System/Unknown')
    expect(data.modifications.headers['X-CircularDemocracy-Status']).toBe('politician-not-found')
  })

  it('should handle duplicate messages', async () => {
    // 1. checkExternalIdExists -> DUPLICATE FOUND
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => [{ id: 999 }] } as Response)

    const req = new Request('http://localhost/mta-hook', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(stalwartPayload)
    })

    const res = await app.fetch(req, env)
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data.action).toBe('accept')
    expect(data.modifications.folder).toBe('CircularDemocracy/System/Duplicates')
    expect(data.modifications.headers['X-CircularDemocracy-Status']).toBe('duplicate')
  })

  it('should handle messages that are too short', async () => {
    // 1. checkExternalIdExists -> not a duplicate
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => [] } as Response)
    // 2. findPoliticianByEmail -> found
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => [{ id: 1, name: 'Test Politician' }] } as Response)

    const shortPayload = { ...stalwartPayload, body: { text: 'short' } }

    const req = new Request('http://localhost/mta-hook', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(shortPayload)
    })

    const res = await app.fetch(req, env)
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data.action).toBe('accept')
    expect(data.modifications.folder).toBe('CircularDemocracy/System/TooShort')
    expect(data.modifications.headers['X-CircularDemocracy-Status']).toBe('message-too-short')
  })
})
