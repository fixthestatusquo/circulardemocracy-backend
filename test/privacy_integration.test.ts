import {
  beforeEach,
  describe,
  expect,
  it,
  type MockedFunction,
  vi,
} from "vitest";
import { DatabaseClient } from "../src/database";
import {
  type Ai,
  type MessageInput,
  processMessage,
} from "../src/message_processor";
import { restoreConsole } from "./setup";

// Mock the embedding service to avoid ONNX runtime issues
vi.mock("../src/embedding_service", () => ({
  generateEmbedding: vi.fn().mockResolvedValue(new Array(1024).fill(0.1)),
  formatEmailContentForEmbedding: vi
    .fn()
    .mockReturnValue("# Test Subject\n\nTest message body"),
}));

global.fetch = vi.fn();
restoreConsole();

describe("Privacy-First Integration Tests", () => {
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

  const mockAi: Ai = {
    run: vi.fn().mockResolvedValue({
      data: [new Array(1024).fill(0.5)],
    }),
  };

  beforeEach(() => {
    db = new DatabaseClient({
      url: "https://test.supabase.co",
      key: "test-key",
    });
    mockFetch.mockClear();
    vi.clearAllMocks();
  });

  describe("API Message Ingestion (/api/v1/messages)", () => {
    // Note: Detailed PII validation is covered in privacy.test.ts
    // These integration tests verify the end-to-end flow

    it("should handle duplicate messages using sender_hash only", async () => {
      const messageInput: MessageInput = {
        external_id: "duplicate-msg",
        sender_name: "Repeat Sender",
        sender_email: "repeat@example.com",
        recipient_email: "politician@gov.com",
        subject: "Same Campaign",
        message: "Another message from the same sender",
        timestamp: "2026-03-12T19:00:00Z",
      };

      // Mock politician lookup
      mockFetch.mockResolvedValueOnce(
        createMockResponse([
          {
            id: 1,
            name: "Politician",
            email: "politician@gov.com",
            active: true,
          },
        ]),
      );

      // Mock duplicate check - message already exists
      mockFetch.mockResolvedValueOnce(
        createMockResponse([
          {
            id: 50,
            external_id: "duplicate-msg",
            campaign_id: 5,
            duplicate_rank: 0,
            campaigns: { id: 5, name: "Existing Campaign" },
          },
        ]),
      );

      const result = await processMessage(db, mockAi, messageInput);

      expect(result.success).toBe(false);
      expect(result.status).toBe("duplicate");
      expect(result.message_id).toBe(50);

      // Verify no insert was attempted (only 2 fetch calls: politician + duplicate check)
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });
  });

  describe("Email Ingestion via Stalwart Webhook", () => {
    it("should store Stalwart JMAP references for email messages", async () => {
      // This test verifies the Stalwart webhook flow stores references
      // Note: We're testing the database layer here since the webhook uses the same insertMessage

      const emailMetadata = {
        external_id: "stalwart-msg-12345",
        channel: "email",
        channel_source: "stalwart",
        politician_id: 3,
        sender_hash: "hashed-sender-email",
        campaign_id: 8,
        classification_confidence: 0.92,
        message_embedding: new Array(1024).fill(0.7),
        language: "auto",
        received_at: "2026-03-12T19:00:00Z",
        duplicate_rank: 0,
        processing_status: "processed",
        sender_flag: "normal",
        is_reply: false,
        stalwart_message_id: "stalwart-msg-12345",
        stalwart_account_id: "politician@gov.com",
      };

      mockFetch.mockResolvedValueOnce(createMockResponse([{ id: 300 }]));

      const result = await db.insertMessage(emailMetadata);

      expect(result).toBe(300);

      const insertCall = mockFetch.mock.calls[0];
      const insertBody = JSON.parse(insertCall[1]?.body as string);

      // VERIFY: Stalwart references ARE present
      expect(insertBody.stalwart_message_id).toBe("stalwart-msg-12345");
      expect(insertBody.stalwart_account_id).toBe("politician@gov.com");

      // VERIFY: No PII is present
      expect(insertBody.sender_email).toBeUndefined();
      expect(insertBody.sender_name).toBeUndefined();
      expect(insertBody.message).toBeUndefined();
      expect(insertBody.subject).toBeUndefined();
      expect(insertBody.body).toBeUndefined();

      // VERIFY: Metadata is present
      expect(insertBody.sender_hash).toBe("hashed-sender-email");
      expect(insertBody.channel).toBe("email");
      expect(insertBody.channel_source).toBe("stalwart");
    });

    it("should extract metadata from email without storing email content", async () => {
      // Simulating what the Stalwart webhook does:
      // 1. Receives email with sender and body
      // 2. Hashes sender email
      // 3. Generates embedding from body
      // 4. Stores only metadata + Stalwart references

      const emailData = {
        messageId: "stalwart-abc-123",
        sender: "citizen@example.com",
        recipients: ["politician@gov.com"],
        subject: "Important Issue",
        body: {
          text: "This is the email body that should not be stored in database",
          html: "<p>HTML version of the email</p>",
        },
      };

      // The webhook would:
      // - Hash emailData.sender → sender_hash
      // - Generate embedding from emailData.body.text
      // - Store stalwart_message_id = emailData.messageId
      // - Store stalwart_account_id = politician@gov.com
      // - NOT store sender, subject, or body

      const metadataOnly = {
        external_id: emailData.messageId,
        channel: "email",
        channel_source: "stalwart",
        politician_id: 5,
        sender_hash: "hash-of-citizen-email", // Hashed, not plaintext
        campaign_id: 10,
        classification_confidence: 0.88,
        message_embedding: new Array(1024).fill(0.6), // From body, not body itself
        language: "auto",
        received_at: new Date().toISOString(),
        duplicate_rank: 0,
        processing_status: "processed",
        stalwart_message_id: emailData.messageId,
        stalwart_account_id: "politician@gov.com",
      };

      mockFetch.mockResolvedValueOnce(createMockResponse([{ id: 400 }]));

      await db.insertMessage(metadataOnly);

      const insertCall = mockFetch.mock.calls[0];
      const insertBody = JSON.parse(insertCall[1]?.body as string);

      // VERIFY: Original email data is NOT in database
      expect(insertBody.sender).toBeUndefined();
      expect(insertBody.subject).toBeUndefined();
      expect(insertBody.body).toBeUndefined();
      expect(insertBody.text).toBeUndefined();
      expect(insertBody.html).toBeUndefined();

      // VERIFY: Only hash and embedding are stored
      expect(insertBody.sender_hash).toBe("hash-of-citizen-email");
      expect(insertBody.message_embedding).toBeDefined();

      // VERIFY: Stalwart references are stored
      expect(insertBody.stalwart_message_id).toBe("stalwart-abc-123");
      expect(insertBody.stalwart_account_id).toBe("politician@gov.com");
    });
  });

  describe("Privacy Enforcement Across Flows", () => {
    it("should reject any attempt to store PII regardless of source", async () => {
      const invalidPayload = {
        external_id: "test-123",
        channel: "email",
        channel_source: "stalwart",
        politician_id: 1,
        sender_hash: "valid-hash",
        sender_email: "leaked@example.com", // FORBIDDEN
        campaign_id: 1,
        classification_confidence: 0.9,
        message_embedding: new Array(1024).fill(0.5),
        language: "en",
        received_at: new Date().toISOString(),
        duplicate_rank: 0,
        processing_status: "processed",
        stalwart_message_id: "msg-123",
        stalwart_account_id: "politician@gov.com",
      } as any;

      await expect(db.insertMessage(invalidPayload)).rejects.toThrow(
        "Privacy violation",
      );
    });

    it("should allow metadata-only payloads from both API and email sources", async () => {
      const apiPayload = {
        external_id: "api-safe",
        channel: "api",
        channel_source: "external",
        politician_id: 1,
        sender_hash: "hash1",
        campaign_id: 1,
        classification_confidence: 0.9,
        message_embedding: new Array(1024).fill(0.5),
        language: "en",
        received_at: new Date().toISOString(),
        duplicate_rank: 0,
        processing_status: "processed",
      };

      const emailPayload = {
        external_id: "email-safe",
        channel: "email",
        channel_source: "stalwart",
        politician_id: 2,
        sender_hash: "hash2",
        campaign_id: 2,
        classification_confidence: 0.85,
        message_embedding: new Array(1024).fill(0.6),
        language: "en",
        received_at: new Date().toISOString(),
        duplicate_rank: 0,
        processing_status: "processed",
        stalwart_message_id: "msg-456",
        stalwart_account_id: "pol@gov.com",
      };

      mockFetch.mockResolvedValueOnce(createMockResponse([{ id: 1 }]));
      mockFetch.mockResolvedValueOnce(createMockResponse([{ id: 2 }]));

      await expect(db.insertMessage(apiPayload)).resolves.toBe(1);
      await expect(db.insertMessage(emailPayload)).resolves.toBe(2);
    });
  });

  describe("Functional Verification", () => {
    it("should maintain duplicate detection functionality with privacy", async () => {
      const senderHash = "consistent-hash-value";

      // First message
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({ "content-range": "*/0" }),
        json: async () => [],
        text: async () => "[]",
        clone: function () {
          return this;
        },
      } as unknown as Response);

      const rank1 = await db.getDuplicateRank(senderHash, 1, 1);
      expect(rank1).toBe(0);

      // Second message from same sender
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({ "content-range": "0-0/1" }),
        json: async () => [{}],
        text: async () => "[{}]",
        clone: function () {
          return this;
        },
      } as unknown as Response);

      const rank2 = await db.getDuplicateRank(senderHash, 1, 1);
      expect(rank2).toBe(1);
    });

    it("should maintain campaign classification functionality with privacy", async () => {
      const embedding = new Array(1024).fill(0.75);

      mockFetch.mockResolvedValueOnce(
        createMockResponse([
          {
            id: 20,
            name: "Education Reform",
            slug: "education-reform",
            status: "active",
            distance: 0.05,
          },
        ]),
      );

      // Mock clustering-related methods to avoid Supabase issues
      vi.spyOn(db, "updateMessageFields").mockResolvedValue(undefined);

      // Mock assignMessageToCluster to bypass clustering logic entirely
      vi.spyOn(db, "assignMessageToCluster" as any).mockResolvedValue(1);

      const result = await db.classifyAndAssignToCluster(123, embedding, 1);

      expect(result.campaign_id).toBe(20);
      expect(result.campaign_name).toBe("Education Reform");
      expect(result.confidence).toBe(0.95);

      // Verify classification uses embedding, not raw text
      const classifyCall = mockFetch.mock.calls[0];
      const requestBody = JSON.parse(classifyCall[1]?.body as string);
      expect(requestBody.query_embedding).toBeDefined();
      expect(requestBody.message_text).toBeUndefined();
    });
  });
});
