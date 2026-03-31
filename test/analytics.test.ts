import { describe, it, expect, vi, beforeEach } from "vitest";
import app from "../src/api";
import { DatabaseClient } from "../src/database";

// --- Create a singleton mock instance ---
const mockDbInstance = {
  request: vi.fn(),
  getMessageAnalytics: vi.fn(),
};

// --- Mock the entire database module ---
vi.mock("../src/database", () => ({
  DatabaseClient: vi.fn(() => mockDbInstance),
}));

// Mock Supabase client for auth
const mockGetUser = vi.fn();
const mockSupabaseClient = {
  auth: {
    getUser: mockGetUser,
  },
};

vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(() => mockSupabaseClient),
}));

describe("Analytics API Integration", () => {
  const env = {
    AI: { run: vi.fn() },
    SUPABASE_URL: "https://test.supabase.co",
    SUPABASE_KEY: "test-key",
    API_KEY: "test-api-key",
    JMAP_API_URL: "https://jmap.example.com",
    JMAP_ACCOUNT_ID: "account-1",
    JMAP_USERNAME: "user",
    JMAP_PASSWORD: "pass",
  };

  beforeEach(() => {
    vi.clearAllMocks();
    // Default: mock failed auth
    mockGetUser.mockResolvedValue({
      data: { user: null },
      error: { message: "Invalid token" },
    });
  });

  it("should return 401 if bearer token is missing", async () => {
    const req = new Request("http://localhost/api/v1/messages/analytics", {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        // Missing Authorization
      },
    });
    const res = await app.fetch(req, env);
    expect(res.status).toBe(401);
  });

  it("should return 401 if bearer token is invalid", async () => {
    const req = new Request("http://localhost/api/v1/messages/analytics", {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer wrong-token",
      },
    });
    const res = await app.fetch(req, env);
    expect(res.status).toBe(401);
  });

  it("should return 200 with analytics data using default days parameter", async () => {
    // Mock successful auth
    mockGetUser.mockResolvedValue({
      data: { user: { id: "user-123", email: "test@example.com" } },
      error: null,
    });

    const mockAnalytics = [
      {
        hour: "2026-03-31T10:00:00Z",
        campaign_id: 1,
        campaign_name: "Climate Action",
        message_count: 15,
      },
      {
        hour: "2026-03-31T11:00:00Z",
        campaign_id: 1,
        campaign_name: "Climate Action",
        message_count: 23,
      },
      {
        hour: "2026-03-31T11:00:00Z",
        campaign_id: 2,
        campaign_name: "Healthcare Reform",
        message_count: 8,
      },
    ];

    mockDbInstance.getMessageAnalytics.mockResolvedValue(mockAnalytics);

    const req = new Request("http://localhost/api/v1/messages/analytics", {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer test-token",
      },
    });
    const res = await app.fetch(req, env);
    expect(res.status).toBe(200);
    const body = await res.json();
    // @ts-ignore
    expect(body.analytics).toEqual(mockAnalytics);
    expect(mockDbInstance.getMessageAnalytics).toHaveBeenCalledWith(7);
  });

  it("should return 200 with analytics data using custom days parameter", async () => {
    // Mock successful auth
    mockGetUser.mockResolvedValue({
      data: { user: { id: "user-123", email: "test@example.com" } },
      error: null,
    });

    const mockAnalytics = [
      {
        hour: "2026-03-30T14:00:00Z",
        campaign_id: 3,
        campaign_name: "Education Funding",
        message_count: 42,
      },
    ];

    mockDbInstance.getMessageAnalytics.mockResolvedValue(mockAnalytics);

    const req = new Request("http://localhost/api/v1/messages/analytics?days=14", {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer test-token",
      },
    });
    const res = await app.fetch(req, env);
    expect(res.status).toBe(200);
    const body = await res.json();
    // @ts-ignore
    expect(body.analytics).toEqual(mockAnalytics);
    expect(mockDbInstance.getMessageAnalytics).toHaveBeenCalledWith(14);
  });

  it("should return empty array when no analytics data is available", async () => {
    // Mock successful auth
    mockGetUser.mockResolvedValue({
      data: { user: { id: "user-123", email: "test@example.com" } },
      error: null,
    });

    mockDbInstance.getMessageAnalytics.mockResolvedValue([]);

    const req = new Request("http://localhost/api/v1/messages/analytics", {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer test-token",
      },
    });
    const res = await app.fetch(req, env);
    expect(res.status).toBe(200);
    const body = await res.json();
    // @ts-ignore
    expect(body.analytics).toEqual([]);
  });

  it("should return 500 if database query fails", async () => {
    // Mock successful auth
    mockGetUser.mockResolvedValue({
      data: { user: { id: "user-123", email: "test@example.com" } },
      error: null,
    });

    mockDbInstance.getMessageAnalytics.mockRejectedValue(
      new Error("Database connection failed"),
    );

    const req = new Request("http://localhost/api/v1/messages/analytics", {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer test-token",
      },
    });
    const res = await app.fetch(req, env);
    expect(res.status).toBe(500);
    const body = await res.json();
    // @ts-ignore
    expect(body.success).toBe(false);
    // @ts-ignore
    expect(body.error).toBe("Failed to fetch message analytics");
  });

  it("should validate days parameter is numeric", async () => {
    // Mock successful auth
    mockGetUser.mockResolvedValue({
      data: { user: { id: "user-123", email: "test@example.com" } },
      error: null,
    });

    const req = new Request("http://localhost/api/v1/messages/analytics?days=invalid", {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer test-token",
      },
    });
    const res = await app.fetch(req, env);
    expect(res.status).toBe(400);
  });
});
