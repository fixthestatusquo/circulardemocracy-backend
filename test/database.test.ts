import {
  beforeEach,
  describe,
  expect,
  it,
  type MockedFunction,
  vi,
} from "vitest";
import { DatabaseClient } from "../src/database";

// Mock fetch globally is now in setup.ts, but we need to cast it for typing
global.fetch = vi.fn();

describe("DatabaseClient", () => {
  let db: DatabaseClient;
  const mockFetch = fetch as MockedFunction<typeof fetch>;

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
    db = new DatabaseClient({
      url: "https://test.supabase.co",
      key: "test-key",
    });
    mockFetch.mockClear();
    mockFetch.mockReset();

    // Mock all database methods that could cause timeouts
    vi.spyOn(db, "getUncategorizedCampaign").mockResolvedValue({
      id: 999,
      name: "Uncategorized",
      slug: "uncategorized",
      status: "active",
      reference_vector: new Array(1024).fill(0),
    });

    vi.spyOn(db, "assignMessageToCluster").mockResolvedValue(1);
    vi.spyOn(db, "updateMessageFields").mockResolvedValue(undefined);
  });

  describe("findPoliticianByEmail", () => {
    it("should find politician by exact email match", async () => {
      const mockPolitician = {
        id: 1,
        name: "John Doe",
        email: "john@example.com",
        additional_emails: [],
      };

      mockFetch.mockResolvedValueOnce(createMockResponse([mockPolitician]));

      const result = await db.findPoliticianByEmail("john@example.com");

      expect(result).toEqual(mockPolitician);
      const url = mockFetch.mock.calls[0][0] as string;
      const options = mockFetch.mock.calls[0][1] as RequestInit;

      expect(url).toContain("https://test.supabase.co/rest/v1/politicians");
      expect(url).toContain("email=eq.john%40example.com");
      expect(url).toContain("active=eq.true");
      expect(url).toContain("select=");

      const headers = options.headers as Headers;
      expect(headers.get("apikey")).toBe("test-key");
      expect(headers.get("Authorization")).toBe("Bearer test-key");
    });

    it("should return null when politician not found", async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => [],
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => [],
        } as Response);

      const result = await db.findPoliticianByEmail("notfound@example.com");

      expect(result).toBeNull();
    });

    it("should handle fetch errors gracefully", async () => {
      mockFetch.mockRejectedValueOnce(new Error("Network error"));

      const result = await db.findPoliticianByEmail("error@example.com");

      expect(result).toBeNull();
    });
  });

  describe("classifyAndAssignToCluster", () => {
    const mockEmbedding = new Array(1024).fill(0.1);
    const mockMessageId = 123;

    it("should use campaign hint when provided and found", async () => {
      const mockCampaign = {
        id: 1,
        name: "Climate Action",
        slug: "climate-action",
        status: "active",
        reference_vector: [0.1, 0.2],
      };

      // Mock updateMessageFields to avoid Supabase issues
      vi.spyOn(db, "updateMessageFields").mockResolvedValue(undefined);

      mockFetch
        .mockResolvedValueOnce(createMockResponse([mockCampaign])) // findCampaignByHint
        .mockResolvedValueOnce(createMockResponse(null)) // assignMessageToCampaign
        .mockResolvedValueOnce(createMockResponse([])) // updateCampaignCentroid - get messages
        .mockResolvedValueOnce(createMockResponse(null)); // updateCampaignCentroid - update

      const result = await db.classifyAndAssignToCluster(
        mockMessageId,
        mockEmbedding,
        1,
        "climate",
      );

      expect(result).toEqual({
        campaign_id: 1,
        campaign_name: "Climate Action",
        confidence: 0.95,
      });
    });

    it("should fall back to vector similarity when hint not found", async () => {
      const mockSimilarCampaign = {
        id: 2,
        name: "Environmental Policy",
        slug: "environmental-policy",
        status: "active",
        distance: 0.05, // Distance <= 0.1 threshold
      };

      mockFetch
        .mockResolvedValueOnce(createMockResponse([])) // No hint match
        .mockResolvedValueOnce(createMockResponse([mockSimilarCampaign])) // findSimilarCampaigns
        .mockResolvedValueOnce(createMockResponse(null)) // assignMessageToCampaign
        .mockResolvedValueOnce(createMockResponse([])) // updateCampaignCentroid - get messages
        .mockResolvedValueOnce(createMockResponse(null)); // updateCampaignCentroid - update

      const result = await db.classifyAndAssignToCluster(
        mockMessageId,
        mockEmbedding,
        1,
        "nonexistent",
      );

      expect(result).toEqual({
        campaign_id: 2,
        campaign_name: "Environmental Policy",
        confidence: 0.95, // 1 - distance = 1 - 0.05 = 0.95
      });
    });

    it("should attempt cluster assignment when no campaign matches found", async () => {
      // Mock the cluster assignment flow - simplified to test the flow without complex RPC calls
      const assignToClusterSpy = vi
        .spyOn(db, "assignMessageToCluster" as any)
        .mockResolvedValue(456);
      // Mock updateMessageFields to avoid Supabase issues
      vi.spyOn(db, "updateMessageFields").mockResolvedValue(undefined);

      mockFetch.mockResolvedValueOnce(createMockResponse([])); // findSimilarCampaigns - no matches

      const result = await db.classifyAndAssignToCluster(
        mockMessageId,
        mockEmbedding,
        1,
      );

      expect(result).toEqual({
        campaign_id: 999, // Uncategorized campaign ID
        campaign_name: "Uncategorized",
        confidence: 0.1,
      });

      // Verify cluster assignment was called
      expect(assignToClusterSpy).toHaveBeenCalledWith(
        mockMessageId,
        mockEmbedding,
        1,
      );
    });

    it("should classify correctly when campaign match is found", async () => {
      const mockSimilarCampaign = {
        id: 3,
        name: "Education Reform",
        slug: "education-reform",
        status: "active",
        distance: 0.05, // Distance <= 0.1 threshold
      };

      mockFetch
        .mockResolvedValueOnce(createMockResponse([mockSimilarCampaign])) // findSimilarCampaigns - found match
        .mockResolvedValueOnce(createMockResponse(null)) // assignMessageToCampaign
        .mockResolvedValueOnce(createMockResponse([])) // updateCampaignCentroid - get messages
        .mockResolvedValueOnce(createMockResponse(null)); // updateCampaignCentroid - update

      const result = await db.classifyAndAssignToCluster(
        mockMessageId,
        mockEmbedding,
        1,
      );

      expect(result).toEqual({
        campaign_id: 3,
        campaign_name: "Education Reform",
        confidence: 0.95, // 1 - distance = 1 - 0.05 = 0.95
      });
    });

    it("should classify correctly when campaign found", async () => {
      const mockCampaign = {
        id: 4,
        name: "Healthcare Reform",
        slug: "healthcare-reform",
        status: "active",
        distance: 0.05,
      };

      // Mock updateMessageFields to avoid Supabase issues
      vi.spyOn(db, "updateMessageFields").mockResolvedValue(undefined);

      mockFetch
        .mockResolvedValueOnce(createMockResponse([mockCampaign])) // findSimilarCampaigns
        .mockResolvedValueOnce(createMockResponse(null)) // assignMessageToCampaign
        .mockResolvedValueOnce(createMockResponse([])) // updateCampaignCentroid - get messages
        .mockResolvedValueOnce(createMockResponse(null)); // updateCampaignCentroid - update

      const result = await db.classifyAndAssignToCluster(
        mockMessageId,
        mockEmbedding,
        1,
      );

      expect(result.campaign_id).toBe(4);
      expect(result.campaign_name).toBe("Healthcare Reform");
      expect(result.confidence).toBe(0.95); // 1 - distance = 1 - 0.05 = 0.95
    });
  });

  describe("getDuplicateRank", () => {
    it("should return correct duplicate count", async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse(null, 200, { "Content-Range": "0-2/3" }),
      );

      const result = await db.getDuplicateRank("hash123", 1, 2);

      expect(result).toBe(3);
    });

    it("should return 0 when no duplicates found", async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse(null, 200, { "Content-Range": "*/0" }),
      );

      const result = await db.getDuplicateRank("hash123", 1, 2);

      expect(result).toBe(0);
    });
  });

  describe("insertMessage", () => {
    it("should insert message and return ID", async () => {
      const mockMessage = {
        external_id: "msg123",
        channel: "api",
        channel_source: "test",
        politician_id: 1,
        sender_hash: "hash123",
        campaign_id: 1,
        classification_confidence: 0.8,
        message_embedding: [0.1, 0.2, 0.3],
        language: "en",
        received_at: "2024-01-01T00:00:00Z",
        duplicate_rank: 0,
        processing_status: "processed",
      };

      mockFetch.mockResolvedValueOnce(createMockResponse([{ id: 42 }]));

      const result = await db.insertMessage(mockMessage);

      expect(result).toBe(42);
    });
  });
});
