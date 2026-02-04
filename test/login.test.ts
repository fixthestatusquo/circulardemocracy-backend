import { describe, it, expect, vi, beforeEach } from 'vitest'
import app from '../src/index' // We test the main app
import { Hono } from 'hono'

// Mock the supabase client
const mockSignInWithPassword = vi.fn()
const mockSupabaseClient = {
  auth: {
    signInWithPassword: mockSignInWithPassword,
  },
}

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => mockSupabaseClient),
}))

describe('Login API', () => {
  const env = {
    SUPABASE_URL: 'https://test.supabase.co',
    SUPABASE_ANON_KEY: 'test-key',
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should return a session on successful login', async () => {
    const mockSession = {
      access_token: 'mock-access-token',
      token_type: 'bearer',
      expires_in: 3600,
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      refresh_token: 'mock-refresh-token',
      user: {
        id: 'user-id-123',
        email: 'test@example.com',
      },
    }

    mockSignInWithPassword.mockResolvedValue({
      data: { session: mockSession },
      error: null,
    })

    const loginCredentials = {
      email: 'test@example.com',
      password: 'password123',
    }

    const req = new Request('http://localhost/api/v1/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(loginCredentials),
    })

    const res = await app.fetch(req, env)
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.access_token).toBe(mockSession.access_token)
    expect(mockSignInWithPassword).toHaveBeenCalledWith(loginCredentials)
  })

  it('should return a 401 on failed login', async () => {
    mockSignInWithPassword.mockResolvedValue({
      data: {},
      error: { code: 'invalid_grant', message: 'Invalid credentials' },
    })

    const loginCredentials = {
      email: 'test@example.com',
      password: 'wrong-password',
    }

    const req = new Request('http://localhost/api/v1/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(loginCredentials),
    })

    const res = await app.fetch(req, env)
    const json = await res.json()

    expect(res.status).toBe(401)
    expect(json.error).toBe('invalid_grant')
    expect(mockSignInWithPassword).toHaveBeenCalledWith(loginCredentials)
  })
})
