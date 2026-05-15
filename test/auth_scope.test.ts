import { beforeEach, describe, expect, it, vi } from "vitest";

const mockSupabaseGetUser = vi.fn();

vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(() => ({
    auth: {
      getUser: mockSupabaseGetUser,
    },
  })),
}));

const { mockDbInstance } = vi.hoisted(() => ({
  mockDbInstance: {
    request: vi.fn(),
    getUserPoliticianIds: vi.fn(),
    getMessagesReadyToSend: vi.fn(),
  },
}));

vi.mock("../src/database", () => ({
  DatabaseClient: vi.fn(function MockDatabaseClient() {
    return mockDbInstance;
  }),
}));

describe("Auth role and scope enforcement", () => {
  let app: (typeof import("../src/api"))["default"];

  const env = {
    AI: { run: vi.fn() },
    SUPABASE_URL: "https://test.supabase.co",
    SUPABASE_KEY: "test-key",
    API_KEY: "test-api-key",
    JMAP_URL: "https://jmap.example.com",
    JMAP_SERVICE_ACCOUNT_EMAIL: "service@example.com",
    JMAP_SERVICE_ACCOUNT_PASSWORD: "password",
  };

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    process.env.SUPABASE_URL = env.SUPABASE_URL;
    process.env.SUPABASE_KEY = env.SUPABASE_KEY;

    mockSupabaseGetUser.mockImplementation(async (token: string) => {
      if (token === "admin-jwt") {
        return {
          data: {
            user: {
              id: "admin-user",
              email: "admin@example.com",
              app_metadata: { role: "admin" },
            },
          },
          error: null,
        };
      }
      if (token === "staff-jwt") {
        return {
          data: {
            user: {
              id: "staff-user",
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

    mockDbInstance.getUserPoliticianIds.mockImplementation(async (userId) => {
      if (userId === "staff-user") {
        return [1];
      }
      return [];
    });
    mockDbInstance.getMessagesReadyToSend.mockResolvedValue([]);
    mockDbInstance.request.mockResolvedValue([
      {
        id: 1,
        name: "Pol One",
        email: "pol1@example.com",
        party: null,
        country: null,
        region: null,
        position: null,
        active: true,
      },
    ]);

    const apiModule = await import("../src/api");
    app = apiModule.default;
  });

  it("returns 403 for staff on admin-only worker health endpoint", async () => {
    const req = new Request("http://localhost/api/v1/worker/health", {
      method: "GET",
      headers: {
        Authorization: "Bearer staff-jwt",
      },
    });

    const res = await app.fetch(req, env);
    expect(res.status).toBe(403);
  });

  it("returns 200 for admin on worker health endpoint", async () => {
    const req = new Request("http://localhost/api/v1/worker/health", {
      method: "GET",
      headers: {
        Authorization: "Bearer admin-jwt",
      },
    });

    const res = await app.fetch(req, env);
    expect(res.status).toBe(200);
  });

  it("scopes politician list by authenticated staff politician IDs", async () => {
    const req = new Request("http://localhost/api/v1/politicians", {
      method: "GET",
      headers: {
        Authorization: "Bearer staff-jwt",
      },
    });

    const res = await app.fetch(req, env);
    expect(res.status).toBe(200);
    expect(mockDbInstance.request).toHaveBeenCalledWith(
      expect.stringContaining("/politicians?id=in.(1)&select="),
    );
  });

});
