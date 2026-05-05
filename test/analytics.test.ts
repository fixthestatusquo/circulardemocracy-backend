import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock the embedding service to avoid ONNX runtime errors
vi.mock("../src/embedding_service.ts", () => ({
  generateEmbedding: vi.fn().mockResolvedValue(new Array(1024).fill(0.1)),
  formatEmailContentForEmbedding: vi
    .fn()
    .mockReturnValue("# Test Subject\n\nTest message body"),
}));

const { mockDbInstance } = vi.hoisted(() => ({
  mockDbInstance: {
    request: vi.fn(),
    getMessageAnalyticsDaily: vi.fn(),
    getUserPoliticianIds: vi.fn(),
  },
}));

// --- Mock the entire database module ---
vi.mock("../src/database", () => ({
  DatabaseClient: vi.fn(function MockDatabaseClient() {
    return mockDbInstance;
  }),
}));

// Mock Supabase client for auth
const mockGetUser = vi.fn();
const mockAnalyticsOrder = vi.fn();
const mockAnalyticsGte = vi.fn();
const mockAnalyticsSelect = vi.fn();
const mockAnalyticsFrom = vi.fn();
const mockAnalyticsQueryResult = {
  data: [] as any[],
  error: null as any,
};

mockAnalyticsOrder.mockImplementation(async () => mockAnalyticsQueryResult);
mockAnalyticsGte.mockImplementation(() => ({ order: mockAnalyticsOrder }));
mockAnalyticsSelect.mockImplementation(() => ({ gte: mockAnalyticsGte }));
mockAnalyticsFrom.mockImplementation(() => ({ select: mockAnalyticsSelect }));

const mockSupabaseClient = {
  auth: {
    getUser: mockGetUser,
  },
  from: mockAnalyticsFrom,
};

vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(() => mockSupabaseClient),
}));

describe("Analytics API Integration", () => {
  let app: typeof import("../src/api")["default"];

  const env = {
    AI: { run: vi.fn() },
    SUPABASE_URL: "https://test.supabase.co",
    SUPABASE_KEY: "test-key",
    API_KEY: "test-api-key",
    JMAP_URL: "https://jmap.example.com",
  };

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    mockAnalyticsQueryResult.data = [];
    mockAnalyticsQueryResult.error = null;
    mockAnalyticsOrder.mockImplementation(async () => mockAnalyticsQueryResult);
    process.env.SUPABASE_URL = env.SUPABASE_URL;
    process.env.SUPABASE_KEY = env.SUPABASE_KEY;
    const apiModule = await import("../src/api");
    app = apiModule.default;
    mockDbInstance.getUserPoliticianIds.mockResolvedValue([1]);
    // Default: mock failed auth
    mockGetUser.mockResolvedValue({
      data: { user: null },
      error: { message: "Invalid token" },
    });
  });

  afterEach(() => {
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_KEY;
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

    // Mock daily aggregated data from message_analytics_view query
    const mockDailyAnalytics = [
      {
        date: "2026-03-31",
        campaign_id: 1,
        campaign_name: "Climate Action",
        message_count: 38,
      },
      {
        date: "2026-03-31",
        campaign_id: 2,
        campaign_name: "Healthcare Reform",
        message_count: 8,
      },
    ];

    mockAnalyticsQueryResult.data = mockDailyAnalytics;
    mockAnalyticsQueryResult.error = null;

    const req = new Request("http://localhost/api/v1/messages/analytics", {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer test-token",
      },
    });
    const res = await app.fetch(req, env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { analytics: typeof mockDailyAnalytics };
    expect(body.analytics).toEqual(mockDailyAnalytics);
    expect(mockAnalyticsFrom).toHaveBeenCalledWith("message_analytics_view");
  });

  it("should return 200 with analytics data using custom days parameter", async () => {
    // Mock successful auth
    mockGetUser.mockResolvedValue({
      data: { user: { id: "user-123", email: "test@example.com" } },
      error: null,
    });

    // Mock daily aggregated data from message_analytics_view query
    const mockDailyAnalytics = [
      {
        date: "2026-03-30",
        campaign_id: 3,
        campaign_name: "Education Funding",
        message_count: 42,
      },
    ];

    mockAnalyticsQueryResult.data = mockDailyAnalytics;
    mockAnalyticsQueryResult.error = null;

    const req = new Request(
      "http://localhost/api/v1/messages/analytics?days=14",
      {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer test-token",
        },
      },
    );
    const res = await app.fetch(req, env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { analytics: typeof mockDailyAnalytics };
    expect(body.analytics).toEqual(mockDailyAnalytics);
    expect(mockAnalyticsFrom).toHaveBeenCalledWith("message_analytics_view");
  });

  it("should return empty array when no analytics data is available", async () => {
    // Mock successful auth
    mockGetUser.mockResolvedValue({
      data: { user: { id: "user-123", email: "test@example.com" } },
      error: null,
    });

    mockAnalyticsQueryResult.data = [];
    mockAnalyticsQueryResult.error = null;

    const req = new Request("http://localhost/api/v1/messages/analytics", {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer test-token",
      },
    });
    const res = await app.fetch(req, env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { analytics: unknown[] };
    expect(body.analytics).toEqual([]);
  });

  it("should return 500 if database query fails", async () => {
    // Mock successful auth
    mockGetUser.mockResolvedValue({
      data: { user: { id: "user-123", email: "test@example.com" } },
      error: null,
    });

    mockAnalyticsQueryResult.data = null as any;
    mockAnalyticsQueryResult.error = { message: "Database connection failed" };

    const req = new Request("http://localhost/api/v1/messages/analytics", {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer test-token",
      },
    });
    const res = await app.fetch(req, env);
    expect(res.status).toBe(500);
    const body = (await res.json()) as { success: boolean; error: string };
    expect(body.success).toBe(false);
    expect(body.error).toBe("Failed to fetch message analytics");
  });

  it("should validate days parameter is numeric", async () => {
    // Mock successful auth
    mockGetUser.mockResolvedValue({
      data: { user: { id: "user-123", email: "test@example.com" } },
      error: null,
    });

    const req = new Request(
      "http://localhost/api/v1/messages/analytics?days=invalid",
      {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer test-token",
        },
      },
    );
    const res = await app.fetch(req, env);
    expect(res.status).toBe(400);
  });
});
