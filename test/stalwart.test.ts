import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  type MockedFunction,
} from "vitest";
import app from "../src/stalwart"; // Test the stalwart app directly

// Mock fetch globally is in setup.ts, but we need to cast it for typing
global.fetch = vi.fn();
const mockFetch = fetch as MockedFunction<typeof fetch>;

describe("Stalwart API (/mta-hook)", () => {
  const env = {
    AI: {
      run: vi.fn(),
    },
    SUPABASE_URL: "https://test.supabase.co",
    SUPABASE_KEY: "test-key",
    API_KEY: "test-api-key",
  };

  // A valid Stalwart webhook payload
  const stalwartPayload = {
    messageId: "stalwart-msg-123",
    sender: "sender@example.com",
    recipients: ["politician@example.com"],
    headers: {
      from: '"Sender Name" <sender@example.com>',
      subject: "Important Issue",
    },
    body: {
      text: "This is a message about an important issue that needs your attention.",
    },
    size: 500,
    timestamp: Math.floor(Date.now() / 1000),
  };

  const createMockResponse = (data: any, status = 200, headers = {}) => {
    return {
      ok: status >= 200 && status < 300,
      status,
      statusText: status === 200 ? "OK" : "Error",
      headers: new Headers({ "Content-Type": "application/json", ...headers }),
      json: async () => data,
      text: async () => JSON.stringify(data),
      clone: function () {
        return this;
      },
    } as unknown as Response;
  };

  beforeEach(() => {
    mockFetch.mockClear();
    env.AI.run.mockClear();
  });

  it("should process a valid email and classify it", async () => {
    // Mock AI embedding for shared classification (happens first in main route)
    env.AI.run.mockResolvedValueOnce({ data: [new Array(1024).fill(0.2)] });

    // 1. classifyMessage (shared, before processing recipients) -> found a match
    mockFetch.mockResolvedValueOnce(createMockResponse([{ id: 10, name: "Test Campaign", similarity: 0.8 }]));
    // 2. checkExternalIdExists -> not a duplicate
    mockFetch.mockResolvedValueOnce(createMockResponse([]));
    // 3. findPoliticianByEmail (exact match) -> found
    mockFetch.mockResolvedValueOnce(createMockResponse([{ id: 1, name: "Test Politician" }]));
    // 4. Mock AI embedding again for message storage
    env.AI.run.mockResolvedValueOnce({ data: [new Array(1024).fill(0.2)] });
    // 5. getDuplicateRank -> not a duplicate
    mockFetch.mockResolvedValueOnce(createMockResponse([{ count: 0 }]));
    // 6. insertMessage -> success
    mockFetch.mockResolvedValueOnce(createMockResponse([{ id: 101 }]));

    const req = new Request("http://localhost/mta-hook", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-KEY": "test-api-key",
      },
      body: JSON.stringify(stalwartPayload),
    });

    const res = await app.fetch(req, env);
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.action).toBe("accept");
    expect(data.modifications.folder).toBe("Test-Campaign/inbox");
    expect(data.modifications.headers["X-CircularDemocracy-Status"]).toBe(
      "processed",
    );
  });

  it("should handle politician not found", async () => {
    // 1. checkExternalIdExists -> not a duplicate
    mockFetch.mockResolvedValueOnce(createMockResponse([]));
    // 2. findPoliticianByEmail (exact) -> not found
    mockFetch.mockResolvedValueOnce(createMockResponse([]));
    // 3. findPoliticianByEmail (additional) -> not found
    mockFetch.mockResolvedValueOnce(createMockResponse([]));

    const req = new Request("http://localhost/mta-hook", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-KEY": "test-api-key",
      },
      body: JSON.stringify(stalwartPayload),
    });

    const res = await app.fetch(req, env);
    const data = await res.json();

    expect(res.status).toBe(200); // The hook itself should not fail
    expect(data.action).toBe("accept");
    expect(data.modifications.folder).toBe("System/Unknown");
    expect(data.modifications.headers["X-CircularDemocracy-Status"]).toBe(
      "politician-not-found",
    );
  });

  it("should handle duplicate messages", async () => {
    // Mock AI embedding for shared classification
    env.AI.run.mockResolvedValueOnce({ data: [new Array(1024).fill(0.2)] });

    // 1. classifyMessage (shared) -> found
    mockFetch.mockResolvedValueOnce(createMockResponse([{ id: 10, name: "Test Campaign", similarity: 0.8 }]));
    // 2. checkExternalIdExists -> DUPLICATE FOUND
    mockFetch.mockResolvedValueOnce(createMockResponse([{ id: 999 }]));

    const req = new Request("http://localhost/mta-hook", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-KEY": "test-api-key",
      },
      body: JSON.stringify(stalwartPayload),
    });

    const res = await app.fetch(req, env);
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.action).toBe("accept");
    expect(data.modifications.folder).toBe("Test-Campaign/Duplicates");
    expect(data.modifications.headers["X-CircularDemocracy-Status"]).toBe(
      "duplicate",
    );
  });

  it("should handle messages that are too short", async () => {
    // 1. checkExternalIdExists -> not a duplicate
    mockFetch.mockResolvedValueOnce(createMockResponse([]));
    // 2. findPoliticianByEmail (exact match) -> found
    mockFetch.mockResolvedValueOnce(createMockResponse([{ id: 1, name: "Test Politician" }]));

    const shortPayload = { ...stalwartPayload, body: { text: "short" } };

    const req = new Request("http://localhost/mta-hook", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-KEY": "test-api-key",
      },
      body: JSON.stringify(shortPayload),
    });

    const res = await app.fetch(req, env);
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.action).toBe("accept");
    expect(data.modifications.folder).toBe("System/TooShort");
    expect(data.modifications.headers["X-CircularDemocracy-Status"]).toBe(
      "message-too-short",
    );
  });

  it("should reject requests without valid X-API-KEY", async () => {
    const req = new Request("http://localhost/mta-hook", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(stalwartPayload),
    });

    const res = await app.fetch(req, env);
    const data = await res.json();

    expect(res.status).toBe(401);
    expect(data.action).toBe("reject");
    expect(data.reject_reason).toContain("Unauthorized");
  });

  it("should reject requests with invalid X-API-KEY", async () => {
    const req = new Request("http://localhost/mta-hook", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-KEY": "wrong-key",
      },
      body: JSON.stringify(stalwartPayload),
    });

    const res = await app.fetch(req, env);
    const data = await res.json();

    expect(res.status).toBe(401);
    expect(data.action).toBe("reject");
    expect(data.reject_reason).toContain("Unauthorized");
  });
});
