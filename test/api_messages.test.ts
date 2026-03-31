import { describe, it, expect, vi, beforeEach } from "vitest";
import app from "../src/api";
import { DatabaseClient } from "../src/database";
import { PoliticianNotFoundError } from "../src/message_processor";

// Mock the embedding service to avoid ONNX runtime issues
vi.mock("../src/embedding_service", () => ({
  generateEmbedding: vi.fn().mockResolvedValue(new Array(1024).fill(0.1)),
  formatEmailContentForEmbedding: vi.fn().mockReturnValue("# Test Subject\n\nTest message body"),
}));

// --- Create a singleton mock instance ---
const mockDbInstance = {
  request: vi.fn(),
  getMessageByExternalId: vi.fn(),
  findPoliticianByEmail: vi.fn(),
  classifyMessage: vi.fn(),
  getDuplicateRank: vi.fn(),
  insertMessage: vi.fn(),
  getActiveTemplateForCampaign: vi.fn(),
  storeSenderEmail: vi.fn(),
};

// --- Mock the entire database module ---
vi.mock("../src/database", () => ({
  DatabaseClient: vi.fn(() => mockDbInstance),
  hashEmail: vi.fn().mockResolvedValue("hashed-email"),
}));

describe("Messages API Integration", () => {
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

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should return 404 if API key is missing", async () => {
    const req = new Request("http://localhost/api/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        // Missing Authorization
      },
      body: JSON.stringify(validMessage),
    });
    const res = await app.fetch(req, env);
    expect(res.status).toBe(404);
  });

  it("should return 404 if API key is invalid", async () => {
    const req = new Request("http://localhost/api/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer wrong-key",
      },
      body: JSON.stringify(validMessage),
    });
    const res = await app.fetch(req, env);
    expect(res.status).toBe(404);
  });

  it("should return 404 if politician is not found", async () => {
    mockDbInstance.findPoliticianByEmail.mockResolvedValue(null);

    const req = new Request("http://localhost/api/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer test-api-key",
      },
      body: JSON.stringify(validMessage),
    });
    const res = await app.fetch(req, env);
    expect(res.status).toBe(404);
    const body = await res.json();
    // @ts-ignore
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
        Authorization: "Bearer test-api-key",
      },
      body: JSON.stringify(validMessage),
    });
    const res = await app.fetch(req, env);
    expect(res.status).toBe(409);
    const body = await res.json();
    // @ts-ignore
    expect(body.status).toBe("duplicate");
  });

  it("should return 400 if schema is invalid", async () => {
    const invalidMessage = { ...validMessage, sender_email: "not-an-email" };
    const req = new Request("http://localhost/api/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer test-api-key",
      },
      body: JSON.stringify(invalidMessage),
    });
    const res = await app.fetch(req, env);
    expect(res.status).toBe(400);
  });

  it("should return 200 and process valid message", async () => {
    mockDbInstance.findPoliticianByEmail.mockResolvedValue({ id: 1 });
    mockDbInstance.getMessageByExternalId.mockResolvedValue(null);
    mockDbInstance.classifyMessage.mockResolvedValue({
      campaign_id: 10,
      campaign_name: "Test Campaign",
      confidence: 0.9,
    });
    mockDbInstance.getDuplicateRank.mockResolvedValue(0);
    mockDbInstance.getActiveTemplateForCampaign.mockResolvedValue(null);
    mockDbInstance.insertMessage.mockResolvedValue(100);
    mockDbInstance.storeSenderEmail.mockResolvedValue(undefined);
    // @ts-ignore
    env.AI.run.mockResolvedValue({ data: [[0.1, 0.2]] });

    const req = new Request("http://localhost/api/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer test-api-key",
      },
      body: JSON.stringify(validMessage),
    });
    const res = await app.fetch(req, env);
    expect(res.status).toBe(200);
    const body = await res.json();
    // @ts-ignore
    expect(body.status).toBe("processed");
    // @ts-ignore
    expect(body.message_id).toBe(100);
  });
});
