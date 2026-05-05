import { describe, it, expect, vi, beforeEach } from "vitest";

const mockSupabaseGetUser = vi.fn();

vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(() => ({
    auth: {
      getUser: mockSupabaseGetUser,
    },
  })),
}));

// Mock the embedding service to avoid ONNX runtime issues
vi.mock("../src/embedding_service.ts", () => ({
  generateEmbedding: vi.fn().mockResolvedValue(new Array(1024).fill(0.1)),
  formatEmailContentForEmbedding: vi
    .fn()
    .mockReturnValue("# Test Subject\n\nTest message body"),
}));

const { mockDbInstance } = vi.hoisted(() => ({
  mockDbInstance: {
    request: vi.fn(),
    getMessageByExternalId: vi.fn(),
    findPoliticianByEmail: vi.fn(),
    classifyAndAssignToCluster: vi.fn(),
    getDuplicateRank: vi.fn(),
    insertMessage: vi.fn(),
    updateMessageFields: vi.fn(),
    getUserPoliticianIds: vi.fn(),
    getActiveTemplateForCampaign: vi.fn(),
    upsertSupporter: vi.fn(),
    storeMessageContact: vi.fn(),
    assignMessageToCluster: vi.fn(),
  },
}));

// --- Mock the entire database module ---
vi.mock("../src/database", () => ({
  DatabaseClient: vi.fn(function MockDatabaseClient() {
    return mockDbInstance;
  }),
  hashEmail: vi.fn().mockResolvedValue("hashed-email"),
}));

describe("Messages API Integration", () => {
  let app: (typeof import("../src/api"))["default"];

  const env = {
    AI: { run: vi.fn() },
    SUPABASE_URL: "https://test.supabase.co",
    SUPABASE_KEY: "test-key",
    API_KEY: "test-api-key",
    JMAP_URL: "https://jmap.example.com",
  };

  afterEach(() => {
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_KEY;
  });

  const validMessage = {
    external_id: "msg123",
    sender_name: "Jane Doe",
    sender_email: "jane@example.com",
    recipient_email: "politician@example.com",
    subject: "Climate Action Needed",
    message: "We need immediate action on climate change.",
    timestamp: new Date().toISOString(),
    campaign_hint: undefined,
  };

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    mockSupabaseGetUser.mockImplementation(async (token: string) => {
      if (token === "valid-jwt") {
        return {
          data: {
            user: {
              id: "user-1",
              email: "staff@example.com",
              app_metadata: { role: "staff" },
            },
          },
          error: null,
        };
      }
      return {
        data: { user: null },
        error: { message: "Invalid token" },
      };
    });
    process.env.SUPABASE_URL = env.SUPABASE_URL;
    process.env.SUPABASE_KEY = env.SUPABASE_KEY;
    mockDbInstance.getUserPoliticianIds.mockResolvedValue([1]);
    mockDbInstance.upsertSupporter.mockResolvedValue(1);
    mockDbInstance.storeMessageContact.mockResolvedValue(undefined);
    const apiModule = await import("../src/api");
    app = apiModule.default;
  });

  it("should return 401 if authorization header is missing", async () => {
    const req = new Request("http://localhost/api/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        // Missing Authorization
      },
      body: JSON.stringify(validMessage),
    });
    const res = await app.fetch(req, env);
    expect(res.status).toBe(401);
  });

  it("should return 401 if token is invalid", async () => {
    const req = new Request("http://localhost/api/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer wrong-key",
      },
      body: JSON.stringify(validMessage),
    });
    const res = await app.fetch(req, env);
    expect(res.status).toBe(401);
  });

  it("should return 403 if politician is outside the caller scope", async () => {
    mockDbInstance.findPoliticianByEmail.mockResolvedValue({ id: 1 });
    mockDbInstance.getUserPoliticianIds.mockResolvedValue([99]);

    const req = new Request("http://localhost/api/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer valid-jwt",
      },
      body: JSON.stringify(validMessage),
    });
    const res = await app.fetch(req, env);
    expect(res.status).toBe(403);
  });

  it("should return 404 if politician is not found", async () => {
    mockDbInstance.findPoliticianByEmail.mockResolvedValue(null);

    const req = new Request("http://localhost/api/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer valid-jwt",
      },
      body: JSON.stringify(validMessage),
    });
    const res = await app.fetch(req, env);
    expect(res.status).toBe(404);
    const body = (await res.json()) as { status: string };
    expect(body.status).toBe("politician_not_found");
  });

  it("should return 409 if message is a duplicate", async () => {
    mockDbInstance.findPoliticianByEmail.mockResolvedValue({ id: 1 });
    // Mock getMessageByExternalId to return an existing message
    mockDbInstance.getMessageByExternalId.mockResolvedValue({
      id: 999,
      campaign_id: 2,
      duplicate_rank: 1,
      campaigns: { id: 2, name: "Existing Campaign" },
    });

    const req = new Request("http://localhost/api/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer valid-jwt",
      },
      body: JSON.stringify(validMessage),
    });
    const res = await app.fetch(req, env);
    expect(res.status).toBe(409);
    const body = (await res.json()) as { status: string };
    expect(body.status).toBe("duplicate");
  });

  it("should return 400 if schema is invalid", async () => {
    const invalidMessage = { ...validMessage, sender_email: "not-an-email" };
    const req = new Request("http://localhost/api/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer valid-jwt",
      },
      body: JSON.stringify(invalidMessage),
    });
    const res = await app.fetch(req, env);
    expect(res.status).toBe(400);
  });

  it("should return 200 and process valid message", async () => {
    mockDbInstance.findPoliticianByEmail.mockResolvedValue({ id: 1 });
    mockDbInstance.getMessageByExternalId.mockResolvedValue(null);
    mockDbInstance.classifyAndAssignToCluster.mockResolvedValue({
      campaign_id: 10,
      campaign_name: "Test Campaign",
      confidence: 0.9,
    });
    mockDbInstance.getDuplicateRank.mockResolvedValue(0);
    mockDbInstance.getActiveTemplateForCampaign.mockResolvedValue(null);
    mockDbInstance.insertMessage.mockResolvedValue(100);
    mockDbInstance.assignMessageToCluster.mockResolvedValue(1);
    mockDbInstance.storeMessageContact.mockResolvedValue(undefined);
    (env.AI.run as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: [[0.1, 0.2]],
    });

    const req = new Request("http://localhost/api/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer valid-jwt",
      },
      body: JSON.stringify(validMessage),
    });
    const res = await app.fetch(req, env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string; message_id: number };
    expect(body.status).toBe("processed");
    expect(body.message_id).toBe(100);
  });
});
