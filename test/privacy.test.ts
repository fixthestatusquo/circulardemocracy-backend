import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  type MockedFunction,
} from "vitest";
import { DatabaseClient, type MessageInsert } from "../src/database";

global.fetch = vi.fn();

describe("Privacy-First Message Storage", () => {
  let db: DatabaseClient;
  const mockFetch = fetch as MockedFunction<typeof fetch>;

  const createMockResponse = (data: any, status = 200) => {
    return {
      ok: status >= 200 && status < 300,
      status,
      statusText: status === 200 ? "OK" : "Error",
      headers: new Headers({ "Content-Type": "application/json" }),
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
  });

  describe("Privacy Validation", () => {
    it("should reject payload containing sender_email", async () => {
      const invalidPayload = {
        external_id: "test-123",
        channel: "email",
        channel_source: "stalwart",
        politician_id: 1,
        sender_hash: "abc123",
        sender_email: "user@example.com", // FORBIDDEN
        campaign_id: 1,
        classification_confidence: 0.9,
        message_embedding: new Array(1024).fill(0),
        language: "en",
        received_at: new Date().toISOString(),
        duplicate_rank: 0,
        processing_status: "processed",
      } as any;

      await expect(db.insertMessage(invalidPayload)).rejects.toThrow(
        "Privacy violation: Cannot store PII in database. Found forbidden fields: sender_email"
      );
    });

    it("should reject payload containing sender_name", async () => {
      const invalidPayload = {
        external_id: "test-123",
        channel: "email",
        channel_source: "stalwart",
        politician_id: 1,
        sender_hash: "abc123",
        sender_name: "John Doe", // FORBIDDEN
        campaign_id: 1,
        classification_confidence: 0.9,
        message_embedding: new Array(1024).fill(0),
        language: "en",
        received_at: new Date().toISOString(),
        duplicate_rank: 0,
        processing_status: "processed",
      } as any;

      await expect(db.insertMessage(invalidPayload)).rejects.toThrow(
        "Privacy violation: Cannot store PII in database. Found forbidden fields: sender_name"
      );
    });

    it("should reject payload containing message body", async () => {
      const invalidPayload = {
        external_id: "test-123",
        channel: "email",
        channel_source: "stalwart",
        politician_id: 1,
        sender_hash: "abc123",
        message: "This is the message body", // FORBIDDEN
        campaign_id: 1,
        classification_confidence: 0.9,
        message_embedding: new Array(1024).fill(0),
        language: "en",
        received_at: new Date().toISOString(),
        duplicate_rank: 0,
        processing_status: "processed",
      } as any;

      await expect(db.insertMessage(invalidPayload)).rejects.toThrow(
        "Privacy violation: Cannot store PII in database. Found forbidden fields: message"
      );
    });

    it("should reject payload containing subject", async () => {
      const invalidPayload = {
        external_id: "test-123",
        channel: "email",
        channel_source: "stalwart",
        politician_id: 1,
        sender_hash: "abc123",
        subject: "Email subject line", // FORBIDDEN
        campaign_id: 1,
        classification_confidence: 0.9,
        message_embedding: new Array(1024).fill(0),
        language: "en",
        received_at: new Date().toISOString(),
        duplicate_rank: 0,
        processing_status: "processed",
      } as any;

      await expect(db.insertMessage(invalidPayload)).rejects.toThrow(
        "Privacy violation: Cannot store PII in database. Found forbidden fields: subject"
      );
    });

    it("should reject payload containing text_content", async () => {
      const invalidPayload = {
        external_id: "test-123",
        channel: "email",
        channel_source: "stalwart",
        politician_id: 1,
        sender_hash: "abc123",
        text_content: "Plain text content", // FORBIDDEN
        campaign_id: 1,
        classification_confidence: 0.9,
        message_embedding: new Array(1024).fill(0),
        language: "en",
        received_at: new Date().toISOString(),
        duplicate_rank: 0,
        processing_status: "processed",
      } as any;

      await expect(db.insertMessage(invalidPayload)).rejects.toThrow(
        "Privacy violation: Cannot store PII in database. Found forbidden fields: text_content"
      );
    });

    it("should reject payload containing html_content", async () => {
      const invalidPayload = {
        external_id: "test-123",
        channel: "email",
        channel_source: "stalwart",
        politician_id: 1,
        sender_hash: "abc123",
        html_content: "<p>HTML content</p>", // FORBIDDEN
        campaign_id: 1,
        classification_confidence: 0.9,
        message_embedding: new Array(1024).fill(0),
        language: "en",
        received_at: new Date().toISOString(),
        duplicate_rank: 0,
        processing_status: "processed",
      } as any;

      await expect(db.insertMessage(invalidPayload)).rejects.toThrow(
        "Privacy violation: Cannot store PII in database. Found forbidden fields: html_content"
      );
    });

    it("should reject payload containing multiple PII fields", async () => {
      const invalidPayload = {
        external_id: "test-123",
        channel: "email",
        channel_source: "stalwart",
        politician_id: 1,
        sender_hash: "abc123",
        sender_email: "user@example.com", // FORBIDDEN
        sender_name: "John Doe", // FORBIDDEN
        message: "Message body", // FORBIDDEN
        subject: "Subject line", // FORBIDDEN
        campaign_id: 1,
        classification_confidence: 0.9,
        message_embedding: new Array(1024).fill(0),
        language: "en",
        received_at: new Date().toISOString(),
        duplicate_rank: 0,
        processing_status: "processed",
      } as any;

      await expect(db.insertMessage(invalidPayload)).rejects.toThrow(
        "Privacy violation: Cannot store PII in database"
      );

      await expect(db.insertMessage(invalidPayload)).rejects.toThrow(
        /sender_email.*sender_name.*message.*subject/
      );
    });

    it("should accept valid payload with metadata only", async () => {
      const validPayload: MessageInsert = {
        external_id: "test-123",
        channel: "email",
        channel_source: "stalwart",
        politician_id: 1,
        sender_hash: "abc123def456", // Hash only, not email
        campaign_id: 1,
        classification_confidence: 0.9,
        message_embedding: new Array(1024).fill(0.5),
        language: "en",
        received_at: new Date().toISOString(),
        duplicate_rank: 0,
        processing_status: "processed",
        stalwart_message_id: "msg-stalwart-123",
        stalwart_account_id: "politician@example.com",
      };

      mockFetch.mockResolvedValueOnce(
        createMockResponse([{ id: 1 }])
      );

      const result = await db.insertMessage(validPayload);
      expect(result).toBe(1);
    });

    it("should accept payload with undefined PII fields (not null)", async () => {
      const validPayload: MessageInsert = {
        external_id: "test-123",
        channel: "email",
        channel_source: "stalwart",
        politician_id: 1,
        sender_hash: "abc123def456",
        campaign_id: 1,
        classification_confidence: 0.9,
        message_embedding: new Array(1024).fill(0.5),
        language: "en",
        received_at: new Date().toISOString(),
        duplicate_rank: 0,
        processing_status: "processed",
        stalwart_message_id: undefined,
        stalwart_account_id: undefined,
      };

      mockFetch.mockResolvedValueOnce(
        createMockResponse([{ id: 2 }])
      );

      const result = await db.insertMessage(validPayload);
      expect(result).toBe(2);
    });
  });

  describe("Metadata Storage Verification", () => {
    it("should store only metadata fields for email ingestion", async () => {
      const metadataPayload: MessageInsert = {
        external_id: "stalwart-msg-456",
        channel: "email",
        channel_source: "stalwart",
        politician_id: 5,
        sender_hash: "sha256hashvalue",
        campaign_id: 10,
        classification_confidence: 0.85,
        message_embedding: new Array(1024).fill(0.3),
        language: "auto",
        received_at: "2026-03-12T19:00:00Z",
        duplicate_rank: 0,
        processing_status: "processed",
        sender_flag: "normal",
        is_reply: false,
        stalwart_message_id: "stalwart-msg-456",
        stalwart_account_id: "politician@gov.com",
      };

      mockFetch.mockResolvedValueOnce(
        createMockResponse([{ id: 100 }])
      );

      await db.insertMessage(metadataPayload);

      // Verify the fetch call was made with correct data
      expect(mockFetch).toHaveBeenCalledTimes(1);
      const fetchCall = mockFetch.mock.calls[0];
      const requestBody = JSON.parse(fetchCall[1]?.body as string);

      // Verify metadata fields are present
      expect(requestBody.external_id).toBe("stalwart-msg-456");
      expect(requestBody.sender_hash).toBe("sha256hashvalue");
      expect(requestBody.campaign_id).toBe(10);
      expect(requestBody.stalwart_message_id).toBe("stalwart-msg-456");
      expect(requestBody.stalwart_account_id).toBe("politician@gov.com");

      // Verify PII fields are NOT present
      expect(requestBody.sender_email).toBeUndefined();
      expect(requestBody.sender_name).toBeUndefined();
      expect(requestBody.message).toBeUndefined();
      expect(requestBody.subject).toBeUndefined();
      expect(requestBody.text_content).toBeUndefined();
      expect(requestBody.html_content).toBeUndefined();
    });

    it("should store metadata with NULL Stalwart references for API messages", async () => {
      const apiPayload: MessageInsert = {
        external_id: "api-msg-789",
        channel: "api",
        channel_source: "external-api",
        politician_id: 3,
        sender_hash: "anotherhashvalue",
        campaign_id: 7,
        classification_confidence: 0.75,
        message_embedding: new Array(1024).fill(0.2),
        language: "auto",
        received_at: "2026-03-12T19:00:00Z",
        duplicate_rank: 1,
        processing_status: "processed",
        stalwart_message_id: undefined,
        stalwart_account_id: undefined,
      };

      mockFetch.mockResolvedValueOnce(
        createMockResponse([{ id: 200 }])
      );

      await db.insertMessage(apiPayload);

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const fetchCall = mockFetch.mock.calls[0];
      const requestBody = JSON.parse(fetchCall[1]?.body as string);

      // Verify API message has no Stalwart references
      expect(requestBody.stalwart_message_id).toBeUndefined();
      expect(requestBody.stalwart_account_id).toBeUndefined();
      expect(requestBody.channel).toBe("api");

      // Verify PII is still not present
      expect(requestBody.sender_email).toBeUndefined();
      expect(requestBody.message).toBeUndefined();
    });
  });

  describe("Duplicate Detection with Privacy", () => {
    it("should calculate duplicate rank using sender_hash only", async () => {
      const senderHash = "hash-of-sender-email";
      const politicianId = 5;
      const campaignId = 10;

      // Mock response with count header
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: "OK",
        headers: new Headers({
          "Content-Type": "application/json",
          "content-range": "0-2/3",
        }),
        json: async () => [],
        text: async () => "[]",
        clone: function () {
          return this;
        },
      } as unknown as Response);

      const rank = await db.getDuplicateRank(senderHash, politicianId, campaignId);

      expect(rank).toBe(3);
      expect(mockFetch).toHaveBeenCalledTimes(1);

      // Verify the query uses sender_hash, not sender_email
      const fetchCall = mockFetch.mock.calls[0];
      const url = fetchCall[0] as string;
      expect(url).toContain("sender_hash=eq.hash-of-sender-email");
      expect(url).not.toContain("sender_email");
    });

    it("should return 0 for first message from sender", async () => {
      const senderHash = "new-sender-hash";
      const politicianId = 1;
      const campaignId = 2;

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: "OK",
        headers: new Headers({
          "Content-Type": "application/json",
          "content-range": "*/0",
        }),
        json: async () => [],
        text: async () => "[]",
        clone: function () {
          return this;
        },
      } as unknown as Response);

      const rank = await db.getDuplicateRank(senderHash, politicianId, campaignId);

      expect(rank).toBe(0);
    });
  });

  describe("Campaign Classification with Privacy", () => {
    it("should classify message using embedding only, not message text", async () => {
      const embedding = new Array(1024).fill(0.5);

      // Mock RPC call for similarity search
      mockFetch.mockResolvedValueOnce(
        createMockResponse([
          {
            id: 15,
            name: "Climate Action",
            slug: "climate-action",
            status: "active",
            distance: 0.05, // Within 0.1 threshold, confidence = 1 - 0.05 = 0.95
          },
        ])
      );

      const result = await db.classifyMessage(embedding, 1);

      expect(result.campaign_id).toBe(15);
      expect(result.campaign_name).toBe("Climate Action");
      expect(result.confidence).toBe(0.95);

      // Verify RPC was called with embedding, not raw text
      const fetchCall = mockFetch.mock.calls[0];
      const requestBody = JSON.parse(fetchCall[1]?.body as string);
      expect(requestBody.query_embedding).toBeDefined();
      expect(requestBody.query_embedding).toHaveLength(1024);
    });
  });
});
