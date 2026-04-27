import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import app from "../src/api";

vi.mock("../src/embedding_service", () => ({
  generateEmbedding: vi.fn().mockResolvedValue(new Array(1024).fill(0.1)),
  formatEmailContentForEmbedding: vi
    .fn()
    .mockReturnValue("# Test Subject\n\nTest message body"),
}));

const { mockDbInstance, mockProcessReplyImmediately } = vi.hoisted(() => ({
  mockDbInstance: {
    request: vi.fn(),
    getActiveTemplateForCampaign: vi.fn(),
    getSupportersForCampaign: vi.fn(),
    getCampaignBroadcastRecipients: vi.fn(),
    createBroadcastMessageForSupporter: vi.fn(),
    storeMessageContact: vi.fn(),
  },
  mockProcessReplyImmediately: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../src/database", () => ({
  DatabaseClient: vi.fn(function MockDatabaseClient() {
    return mockDbInstance;
  }),
}));

vi.mock("../src/reply_worker", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/reply_worker")>();
  return {
    ...actual,
    processReplyImmediately: mockProcessReplyImmediately,
  };
});

const mockGetUser = vi.fn();
const mockSupabaseClient = {
  auth: {
    getUser: mockGetUser,
  },
};

vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(() => mockSupabaseClient),
}));

describe("Campaign broadcast replies API", () => {
  const envNoJmap = {
    AI: { run: vi.fn() },
    SUPABASE_URL: "https://test.supabase.co",
    SUPABASE_KEY: "test-key",
    API_KEY: "test-api-key",
  };

  const envWithJmap = {
    ...envNoJmap,
    JMAP_API_URL: "https://jmap.example.com",
    JMAP_ACCOUNT_ID: "account-1",
    JMAP_USERNAME: "user",
    JMAP_PASSWORD: "pass",
  };

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.SUPABASE_URL = envNoJmap.SUPABASE_URL;
    process.env.SUPABASE_KEY = envNoJmap.SUPABASE_KEY;
    mockGetUser.mockResolvedValue({
      data: { user: { id: "user-1", email: "u@example.com" } },
      error: null,
    });
    mockDbInstance.getActiveTemplateForCampaign.mockResolvedValue({
      id: 1,
      campaign_id: 1,
      name: "Default",
      subject: "Thanks",
      body: "Hello",
      active: true,
      layout_type: "text_only",
      send_timing: "immediate",
      scheduled_for: null,
    });
    mockProcessReplyImmediately.mockResolvedValue(undefined);
  });

  afterEach(() => {
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_KEY;
  });

  function broadcastReq(campaignId: string, env: typeof envNoJmap) {
    return new Request(
      `http://localhost/api/v1/campaigns/${campaignId}/replies/broadcast`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer valid-session-token",
        },
      },
    );
  }

  it("returns 401 when Authorization is missing", async () => {
    const req = new Request(
      "http://localhost/api/v1/campaigns/1/replies/broadcast",
      { method: "POST" },
    );
    const res = await app.fetch(req, envNoJmap);
    expect(res.status).toBe(401);
    expect(mockProcessReplyImmediately).not.toHaveBeenCalled();
  });

  it("returns 400 when there are no supporters and no recipients", async () => {
    mockDbInstance.getSupportersForCampaign.mockResolvedValue([]);
    mockDbInstance.getCampaignBroadcastRecipients.mockResolvedValue([]);

    const res = await app.fetch(broadcastReq("7", envNoJmap), envNoJmap);
    expect(res.status).toBe(400);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.success).toBe(false);
    expect(body.campaign_id).toBe(7);
    expect(String(body.error)).toContain("No supporters");
    expect(mockProcessReplyImmediately).not.toHaveBeenCalled();
  });

  it("returns 400 when supporters exist but broadcast recipients are empty", async () => {
    mockDbInstance.getSupportersForCampaign.mockResolvedValue([
      { id: 1, campaign_id: 3, politician_id: 1, sender_hash: "abc" },
    ]);
    mockDbInstance.getCampaignBroadcastRecipients.mockResolvedValue([]);

    const res = await app.fetch(broadcastReq("3", envNoJmap), envNoJmap);
    expect(res.status).toBe(400);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.success).toBe(false);
    expect(String(body.error)).toContain("short-term message contacts");
  });

  it("creates broadcast rows and still attempts send without global JMAP env", async () => {
    mockDbInstance.getSupportersForCampaign.mockResolvedValue([
      { id: 1, campaign_id: 2, politician_id: 1, sender_hash: "h1" },
    ]);
    mockDbInstance.getCampaignBroadcastRecipients.mockResolvedValue([
      {
        politician_id: 1,
        sender_hash: "h1",
        email: "citizen1@example.com",
      },
      {
        politician_id: 1,
        sender_hash: "h2",
        email: "citizen2@example.com",
      },
    ]);
    mockDbInstance.createBroadcastMessageForSupporter
      .mockResolvedValueOnce(101)
      .mockResolvedValueOnce(102);
    mockDbInstance.storeMessageContact.mockResolvedValue(undefined);

    const res = await app.fetch(broadcastReq("2", envNoJmap), envNoJmap);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.success).toBe(true);
    expect(body.campaign_id).toBe(2);
    expect(body.messages_created).toBe(2);
    expect(body.recipient_count).toBe(2);
    expect(body.jmap_ready).toBe(true);
    expect(body.replies_sent).toBe(2);
    expect(body.replies_failed).toBe(0);
    expect(mockProcessReplyImmediately).toHaveBeenCalledTimes(2);
    expect(mockDbInstance.createBroadcastMessageForSupporter).toHaveBeenCalledTimes(
      2,
    );
    expect(mockDbInstance.storeMessageContact).toHaveBeenCalledTimes(2);
  });

  it("invokes processReplyImmediately for each created message when JMAP is configured", async () => {
    mockDbInstance.getSupportersForCampaign.mockResolvedValue([
      { id: 1, campaign_id: 5, politician_id: 2, sender_hash: "x" },
    ]);
    mockDbInstance.getCampaignBroadcastRecipients.mockResolvedValue([
      {
        politician_id: 2,
        sender_hash: "x",
        email: "a@example.com",
      },
    ]);
    mockDbInstance.createBroadcastMessageForSupporter.mockResolvedValue(501);
    mockDbInstance.storeMessageContact.mockResolvedValue(undefined);

    const res = await app.fetch(broadcastReq("5", envWithJmap), envWithJmap);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.jmap_ready).toBe(true);
    expect(body.replies_sent).toBe(1);
    expect(body.replies_failed).toBe(0);
    expect(mockProcessReplyImmediately).toHaveBeenCalledTimes(1);
    expect(mockProcessReplyImmediately).toHaveBeenCalledWith(
      mockDbInstance,
      501,
      expect.objectContaining({
        JMAP_API_URL: "https://jmap.example.com",
      }),
    );
  });

  it("counts createBroadcast failures and surfaces JMAP send errors", async () => {
    mockDbInstance.getSupportersForCampaign.mockResolvedValue([
      { id: 1, campaign_id: 9, politician_id: 1, sender_hash: "s" },
    ]);
    mockDbInstance.getCampaignBroadcastRecipients.mockResolvedValue([
      { politician_id: 1, sender_hash: "s1", email: "e1@example.com" },
      { politician_id: 1, sender_hash: "s2", email: "e2@example.com" },
    ]);
    mockDbInstance.createBroadcastMessageForSupporter
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(902);
    mockDbInstance.storeMessageContact.mockResolvedValue(undefined);
    mockProcessReplyImmediately.mockRejectedValueOnce(new Error("SMTP down"));

    const res = await app.fetch(broadcastReq("9", envWithJmap), envWithJmap);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.messages_created).toBe(1);
    expect(body.failures).toBe(1);
    expect(body.replies_sent).toBe(0);
    expect(body.replies_failed).toBe(1);
    expect(body.success).toBe(false);
    expect(body.first_send_error).toBe("SMTP down");
  });
});
