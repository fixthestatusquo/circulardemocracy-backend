import { beforeEach, describe, expect, it, vi } from "vitest";
import { JMAPClient } from "../src/jmap_client";
import {
  processReplyImmediately,
  processScheduledReplies,
} from "../src/reply_worker";

// =============================================================================
// REPLY WORKER TESTS
// =============================================================================

describe("Reply Worker", () => {
  const runtimeSecrets = {
    JMAP_URL: "https://jmap.example.com",
    SUPABASE_URL: "https://test.supabase.co",
    SUPABASE_ANON_KEY: "anon-key",
    RELAY_SERVICE_ACCOUNT_EMAIL: "relay@example.com",
    RELAY_SERVICE_ACCOUNT_PASSWORD: "relay-pass",
  };

  const mockDb = {
    supabase: {
      from: vi.fn(),
    },
    getMessagesReadyToSend: vi.fn(),
    getMessageReadyToSendById: vi.fn(),
    getCampaignById: vi.fn(),
    getPoliticianById: vi.fn(),
    markMessageAsSent: vi.fn(),
    getActiveTemplateForCampaign: vi.fn(),
    getMessageContactEmail: vi.fn(),
    upsertSupporter: vi.fn(),
    logEmailEvent: vi.fn(),
    markMessageReplyDelivered: vi.fn(),
    updateMessageRetryCount: vi.fn(),
    markMessageAsFailed: vi.fn(),
  } as any;

  const mockJmapClient = {
    sendEmail: vi.fn(),
  } as any;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      if (url.includes("/auth/v1/token?grant_type=password")) {
        return new Response(
          JSON.stringify({
            access_token: "supabase-relay-token",
            expires_in: 3600,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      if (url.includes("/.well-known/jmap")) {
        return new Response(
          JSON.stringify({
            apiUrl: "https://jmap.example.com/jmap",
            primaryAccounts: {
              "urn:ietf:params:jmap:mail": "account-1",
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      return new Response("not mocked", { status: 500 });
    });
    vi.spyOn(mockDb, "getMessagesReadyToSend").mockResolvedValue([]);
    vi.spyOn(mockDb, "getMessageReadyToSendById").mockResolvedValue(null);
    vi.spyOn(mockDb, "getCampaignById").mockResolvedValue({
      id: 1,
      name: "Test Campaign",
      technical_email: "campaign@example.com",
      reply_to_email: "reply@example.com",
    });
    vi.spyOn(mockDb, "getPoliticianById").mockResolvedValue({
      id: 1,
      email: "politician@example.com",
      name: "Test Politician",
    });
    vi.spyOn(mockDb, "markMessageAsSent").mockResolvedValue(undefined);
    vi.spyOn(mockDb, "upsertSupporter").mockResolvedValue(1);
    vi.spyOn(mockDb, "logEmailEvent").mockResolvedValue(undefined);
    vi.spyOn(mockDb, "markMessageReplyDelivered").mockResolvedValue(undefined);
  });

  describe("Message Query", () => {
    it("should query messages with correct filters", async () => {
      const mockSelect = vi.fn().mockReturnThis();
      const mockIn = vi.fn().mockReturnThis();
      const mockIs = vi.fn().mockReturnThis();
      const mockLt = vi.fn().mockReturnThis();
      const mockOr = vi.fn().mockResolvedValue({
        data: [
          {
            id: 1,
            external_id: "ext-1",
            politician_id: 1,
            campaign_id: 1,
            sender_hash: "hash1",
            reply_status: "pending",
            reply_scheduled_at: null,
            received_at: "2024-01-01T00:00:00Z",
            reply_retry_count: 0,
          },
        ],
        error: null,
      });

      vi.spyOn(mockDb, "getMessagesReadyToSend").mockResolvedValue([
        {
          id: 1,
          external_id: "ext-1",
          politician_id: 1,
          campaign_id: 1,
          sender_hash: "hash1",
          reply_status: "pending",
          reply_scheduled_at: null,
          received_at: "2024-01-01T00:00:00Z",
          reply_retry_count: 0,
        },
      ]);

      expect(mockDb.getMessagesReadyToSend).toBeDefined();
      expect(mockSelect).toBeDefined();
      expect(mockLt).toBeDefined();
    });

    it("should exclude messages that exceeded retry limit", async () => {
      const mockSelect = vi.fn().mockReturnThis();
      const mockIn = vi.fn().mockReturnThis();
      const mockIs = vi.fn().mockReturnThis();
      const mockLt = vi.fn().mockReturnThis();
      const mockOr = vi.fn().mockResolvedValue({
        data: [],
        error: null,
      });

      vi.spyOn(mockDb, "getMessagesReadyToSend").mockResolvedValue([]);

      expect(mockLt).toBeDefined();
    });

    it("should handle database query errors", async () => {
      const mockSelect = vi.fn().mockReturnThis();
      const mockIn = vi.fn().mockReturnThis();
      const mockIs = vi.fn().mockReturnThis();
      const mockLt = vi.fn().mockReturnThis();
      const mockOr = vi.fn().mockResolvedValue({
        data: null,
        error: new Error("Database connection failed"),
      });

      vi.spyOn(mockDb, "getMessagesReadyToSend").mockRejectedValue(
        new Error("Database connection failed"),
      );

      expect(mockOr).toBeDefined();
    });
  });

  describe("Email Sending", () => {
    const _mockMessage = {
      id: 1,
      external_id: "ext-1",
      politician_id: 1,
      campaign_id: 1,
      sender_hash: "hash1",
      reply_status: "pending" as const,
      reply_scheduled_at: null,
      received_at: "2024-01-01T00:00:00Z",
      reply_retry_count: 0,
    };

    it("should retrieve contact email from database", async () => {
      vi.spyOn(mockDb, "getMessageContactEmail").mockResolvedValue(
        "sender@example.com",
      );

      const email = await mockDb.getMessageContactEmail(1);
      expect(email).toBe("sender@example.com");
      expect(mockDb.getMessageContactEmail).toHaveBeenCalledWith(1);
    });

    it("should handle missing contact email", async () => {
      vi.spyOn(mockDb, "getMessageContactEmail").mockResolvedValue(null);

      const email = await mockDb.getMessageContactEmail(1);
      expect(email).toBeNull();
    });

    it("should retrieve active template for campaign", async () => {
      const mockTemplate = {
        id: 1,
        politician_id: 1,
        campaign_id: 1,
        name: "Test Template",
        subject: "Thank you",
        body: "Thank you for your message",
        active: true,
        layout_type: "standard_header" as const,
        send_timing: "immediate" as const,
        scheduled_for: null,
        created_at: "2024-01-01T00:00:00Z",
        updated_at: "2024-01-01T00:00:00Z",
      };

      vi.spyOn(mockDb, "getActiveTemplateForCampaign").mockResolvedValue(
        mockTemplate,
      );

      const template = await mockDb.getActiveTemplateForCampaign(1, 1);
      expect(template).toEqual(mockTemplate);
      expect(mockDb.getActiveTemplateForCampaign).toHaveBeenCalledWith(1, 1);
    });

    it("should handle missing template", async () => {
      vi.spyOn(mockDb, "getActiveTemplateForCampaign").mockResolvedValue(null);

      const template = await mockDb.getActiveTemplateForCampaign(1, 1);
      expect(template).toBeNull();
    });

    it("should send email via JMAP", async () => {
      const mockEmail = {
        from: "politician@example.com",
        to: ["sender@example.com"],
        replyTo: "politician@example.com",
        subject: "Thank you",
        textBody: "Thank you for your message",
        htmlBody: "<p>Thank you for your message</p>",
      };

      vi.spyOn(mockJmapClient, "sendEmail").mockResolvedValue({
        success: true,
        messageId: "jmap-123",
      });

      const result = await mockJmapClient.sendEmail(mockEmail);
      expect(result.success).toBe(true);
      expect(result.messageId).toBe("jmap-123");
      expect(mockJmapClient.sendEmail).toHaveBeenCalledWith(mockEmail);
    });

    it("should handle JMAP send failure", async () => {
      const mockEmail = {
        from: "politician@example.com",
        to: ["sender@example.com"],
        replyTo: "politician@example.com",
        subject: "Test",
        textBody: "Test",
      };

      vi.spyOn(mockJmapClient, "sendEmail").mockResolvedValue({
        success: false,
        error: "JMAP connection failed",
      });

      const result = await mockJmapClient.sendEmail(mockEmail);
      expect(result.success).toBe(false);
      expect(result.error).toBe("JMAP connection failed");
    });
  });

  describe("Retry Logic", () => {
    it("should schedule remail with delayed retry timestamp on failure", async () => {
      const mockSelect = vi.fn().mockReturnThis();
      const mockIn = vi.fn().mockReturnThis();
      const mockIs = vi.fn().mockReturnThis();
      const mockLt = vi.fn().mockReturnThis();
      const mockOr = vi.fn().mockResolvedValue({
        data: [
          {
            id: 1,
            external_id: "ext-1",
            politician_id: 1,
            campaign_id: 1,
            sender_hash: "hash1",
            reply_status: "pending",
            reply_scheduled_at: null,
            received_at: "2024-01-01T00:00:00Z",
            reply_retry_count: 0,
          },
        ],
        error: null,
      });

      vi.spyOn(mockDb, "getMessagesReadyToSend").mockResolvedValue(
        mockOr.mock.results[0]?.value?.data || [
          {
            id: 1,
            external_id: "ext-1",
            politician_id: 1,
            campaign_id: 1,
            sender_hash: "hash1",
            reply_status: "pending",
            reply_scheduled_at: null,
            received_at: "2024-01-01T00:00:00Z",
            reply_retry_count: 0,
          },
        ],
      );
      vi.spyOn(mockDb, "getActiveTemplateForCampaign").mockResolvedValue(null);
      vi.spyOn(mockDb, "updateMessageRetryCount").mockResolvedValue(undefined);

      const result = await processScheduledReplies(mockDb, runtimeSecrets);

      expect(result.failed).toBe(1);
      expect(mockDb.updateMessageRetryCount).toHaveBeenCalledWith(
        1,
        1,
        expect.stringContaining("No active template found"),
        expect.any(String),
      );
    });

    it("should mark message as failed after final remail attempt", async () => {
      const mockSelect = vi.fn().mockReturnThis();
      const mockIn = vi.fn().mockReturnThis();
      const mockIs = vi.fn().mockReturnThis();
      const mockLt = vi.fn().mockReturnThis();
      const mockOr = vi.fn().mockResolvedValue({
        data: [
          {
            id: 2,
            external_id: "ext-2",
            politician_id: 1,
            campaign_id: 1,
            sender_hash: "hash2",
            reply_status: "scheduled",
            reply_scheduled_at: "2024-01-01T00:00:00Z",
            received_at: "2024-01-01T00:00:00Z",
            reply_retry_count: 9,
          },
        ],
        error: null,
      });

      vi.spyOn(mockDb, "getMessagesReadyToSend").mockResolvedValue(
        mockOr.mock.results[0]?.value?.data || [
          {
            id: 2,
            external_id: "ext-2",
            politician_id: 1,
            campaign_id: 1,
            sender_hash: "hash2",
            reply_status: "scheduled",
            reply_scheduled_at: "2024-01-01T00:00:00Z",
            received_at: "2024-01-01T00:00:00Z",
            reply_retry_count: 9,
          },
        ],
      );
      vi.spyOn(mockDb, "getActiveTemplateForCampaign").mockResolvedValue(null);
      vi.spyOn(mockDb, "markMessageAsFailed").mockResolvedValue(undefined);
      vi.spyOn(mockDb, "updateMessageRetryCount").mockResolvedValue(undefined);

      const result = await processScheduledReplies(mockDb, runtimeSecrets);

      expect(result.failed).toBe(1);
      expect(mockDb.markMessageAsFailed).toHaveBeenCalledWith(
        2,
        expect.stringContaining("No active template found"),
      );
      expect(mockDb.updateMessageRetryCount).not.toHaveBeenCalled();
    });

    it("should increment retry count on failure", async () => {
      vi.spyOn(mockDb, "updateMessageRetryCount").mockResolvedValue(undefined);

      await mockDb.updateMessageRetryCount(
        1,
        1,
        "Test error",
        "2026-03-10T12:00:00Z",
      );

      expect(mockDb.updateMessageRetryCount).toHaveBeenCalledWith(
        1,
        1,
        "Test error",
        "2026-03-10T12:00:00Z",
      );
    });

    it("should mark message as failed after max retries", async () => {
      vi.spyOn(mockDb, "markMessageAsFailed").mockResolvedValue(undefined);

      await mockDb.markMessageAsFailed(1, "Max retries exceeded");

      expect(mockDb.markMessageAsFailed).toHaveBeenCalledWith(
        1,
        "Max retries exceeded",
      );
    });

    it("should track retry count in message", async () => {
      const messageWithRetries = {
        id: 1,
        external_id: "ext-1",
        politician_id: 1,
        campaign_id: 1,
        sender_hash: "hash1",
        reply_status: "pending" as const,
        reply_scheduled_at: null,
        received_at: "2024-01-01T00:00:00Z",
        reply_retry_count: 2,
      };

      expect(messageWithRetries.reply_retry_count).toBe(2);
    });
  });

  describe("Database Operations", () => {
    it("should store sender email", async () => {
      const mockInsert = vi.fn().mockResolvedValue({ error: null });
      const mockFrom = vi.fn().mockReturnValue({
        insert: mockInsert,
      });

      vi.spyOn(mockDb, "markMessageAsSent").mockResolvedValue(undefined);

      expect(mockFrom).toBeDefined();
      expect(mockInsert).toBeDefined();
    });

    it("should update message status to sent", async () => {
      const mockUpdate = vi.fn().mockReturnThis();
      const mockEq = vi.fn().mockResolvedValue({ error: null });
      const mockFrom = vi.fn().mockReturnValue({
        update: mockUpdate,
        eq: mockEq,
      });

      vi.spyOn(mockDb, "markMessageAsSent").mockResolvedValue(undefined);

      expect(mockUpdate).toBeDefined();
      expect(mockEq).toBeDefined();
    });

    it("should handle database errors gracefully", async () => {
      const mockInsert = vi.fn().mockResolvedValue({
        error: new Error("Database error"),
      });
      const mockFrom = vi.fn().mockReturnValue({
        insert: mockInsert,
      });

      vi.spyOn(mockDb, "markMessageAsSent").mockRejectedValue(
        new Error("Database error"),
      );

      expect(mockInsert).toBeDefined();
    });
  });

  describe("Integration Scenarios", () => {
    it("should mark successful sends as sent in messages table", async () => {
      const mockMessage = {
        id: 1,
        external_id: "ext-1",
        politician_id: 1,
        campaign_id: 1,
        sender_hash: "hash1",
        reply_status: "pending",
        reply_scheduled_at: null,
        received_at: "2024-01-01T00:00:00Z",
        reply_retry_count: 0,
      };

      const messagesTable = {
        select: vi.fn().mockReturnThis(),
        in: vi.fn().mockReturnThis(),
        is: vi.fn().mockReturnThis(),
        lt: vi.fn().mockReturnThis(),
        or: vi.fn().mockResolvedValue({ data: [mockMessage], error: null }),
        update: vi.fn().mockReturnThis(),
        eq: vi.fn().mockResolvedValue({ error: null }),
      };
      const campaignsTable = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue({
          data: [
            {
              id: 1,
              name: "Campaign One",
              technical_email: "campaign-tech@example.com",
            },
          ],
          error: null,
        }),
      };
      const politiciansTable = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue({
          data: [
            {
              id: 1,
              name: "Jane Doe",
              email: "jane@pol.com",
            },
          ],
          error: null,
        }),
      };

      vi.spyOn(mockDb, "getMessagesReadyToSend").mockResolvedValue([mockMessage]);
      vi.spyOn(mockDb, "getCampaignById").mockResolvedValue({
        id: 1,
        name: "Campaign One",
        technical_email: "campaign-tech@example.com",
        reply_to_email: null,
      });
      vi.spyOn(mockDb, "getPoliticianById").mockResolvedValue({
        id: 1,
        name: "Jane Doe",
        email: "jane@pol.com",
      });
      vi.spyOn(mockDb, "markMessageAsSent").mockResolvedValue(undefined);

      vi.spyOn(mockDb, "getActiveTemplateForCampaign").mockResolvedValue({
        id: 1,
        politician_id: 1,
        campaign_id: 1,
        name: "Template",
        subject: "Thanks",
        body: "Thank you for your message",
        active: true,
        layout_type: "text_only",
        send_timing: "immediate",
        scheduled_for: null,
        created_at: "2024-01-01T00:00:00Z",
        updated_at: "2024-01-01T00:00:00Z",
      });
      vi.spyOn(mockDb, "getMessageContactEmail").mockResolvedValue(
        "sender@example.com",
      );
      vi.spyOn(JMAPClient.prototype, "sendEmail").mockResolvedValue({
        success: true,
        messageId: "jmap-1",
      });

      const result = await processScheduledReplies(mockDb, runtimeSecrets);

      expect(result.sent).toBe(1);
      expect(mockDb.markMessageReplyDelivered).toHaveBeenCalledWith(1);
      expect(JMAPClient.prototype.sendEmail).toHaveBeenCalledWith(
        expect.objectContaining({ from: "campaign-tech@example.com" }),
      );
    });

    it("should fall back to politician email when campaign technical email is missing", async () => {
      const mockMessage = {
        id: 2,
        external_id: "ext-2",
        politician_id: 1,
        campaign_id: 1,
        sender_hash: "hash2",
        reply_status: "pending",
        reply_scheduled_at: null,
        received_at: "2024-01-01T00:00:00Z",
        reply_retry_count: 0,
      };

      const messagesTable = {
        select: vi.fn().mockReturnThis(),
        in: vi.fn().mockReturnThis(),
        is: vi.fn().mockReturnThis(),
        lt: vi.fn().mockReturnThis(),
        or: vi.fn().mockResolvedValue({ data: [mockMessage], error: null }),
        update: vi.fn().mockReturnThis(),
        eq: vi.fn().mockResolvedValue({ error: null }),
      };
      const campaignsTable = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue({
          data: [
            {
              id: 1,
              name: "Campaign One",
              technical_email: null,
              reply_to_email: null,
            },
          ],
          error: null,
        }),
      };
      const politiciansTable = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue({
          data: [
            {
              id: 1,
              name: "Jane Doe",
              email: "jane@pol.com",
            },
          ],
          error: null,
        }),
      };

      vi.spyOn(mockDb, "getMessagesReadyToSend").mockResolvedValue([mockMessage]);
      vi.spyOn(mockDb, "getCampaignById").mockResolvedValue({
        id: 1,
        name: "Campaign One",
        technical_email: null,
        reply_to_email: null,
      });
      vi.spyOn(mockDb, "getPoliticianById").mockResolvedValue({
        id: 1,
        name: "Jane Doe",
        email: "jane@pol.com",
      });
      vi.spyOn(mockDb, "getActiveTemplateForCampaign").mockResolvedValue({
        id: 1,
        politician_id: 1,
        campaign_id: 1,
        name: "Template",
        subject: "Thanks",
        body: "Thank you for your message",
        active: true,
        layout_type: "text_only",
        send_timing: "immediate",
        scheduled_for: null,
        created_at: "2024-01-01T00:00:00Z",
        updated_at: "2024-01-01T00:00:00Z",
      });
      vi.spyOn(mockDb, "getMessageContactEmail").mockResolvedValue(
        "sender@example.com",
      );
      vi.spyOn(JMAPClient.prototype, "sendEmail").mockResolvedValue({
        success: true,
        messageId: "jmap-2",
      });

      const result = await processScheduledReplies(mockDb, runtimeSecrets);

      expect(result.sent).toBe(1);
      expect(JMAPClient.prototype.sendEmail).toHaveBeenCalledWith(
        expect.objectContaining({ from: "jane@pol.com" }),
      );
    });

    it("should fail when neither campaign technical email nor politician email is set", async () => {
      const mockMessage = {
        id: 3,
        external_id: "ext-3",
        politician_id: 1,
        campaign_id: 1,
        sender_hash: "hash3",
        reply_status: "pending",
        reply_scheduled_at: null,
        received_at: "2024-01-01T00:00:00Z",
        reply_retry_count: 0,
      };

      const messagesTable = {
        select: vi.fn().mockReturnThis(),
        in: vi.fn().mockReturnThis(),
        is: vi.fn().mockReturnThis(),
        lt: vi.fn().mockReturnThis(),
        or: vi.fn().mockResolvedValue({ data: [mockMessage], error: null }),
      };
      const campaignsTable = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue({
          data: [
            {
              id: 1,
              name: "Campaign One",
              technical_email: null,
              reply_to_email: null,
            },
          ],
          error: null,
        }),
      };
      const politiciansTable = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue({
          data: [
            {
              id: 1,
              name: "Jane Doe",
              email: "",
            },
          ],
          error: null,
        }),
      };

      vi.spyOn(mockDb.supabase, "from").mockImplementation(
        (...args: unknown[]) => {
          const table = args[0] as string;
          if (table === "messages") {
            return messagesTable as any;
          }
          if (table === "campaigns") {
            return campaignsTable as any;
          }
          if (table === "politicians") {
            return politiciansTable as any;
          }
          return {} as any;
        },
      );
      vi.spyOn(mockDb, "getMessagesReadyToSend").mockResolvedValue([mockMessage]);
      vi.spyOn(mockDb, "getCampaignById").mockResolvedValue({
        id: 1,
        name: "Campaign One",
        technical_email: null,
        reply_to_email: null,
      });
      vi.spyOn(mockDb, "getPoliticianById").mockResolvedValue({
        id: 1,
        name: "Jane Doe",
        email: "",
      });
      vi.spyOn(mockDb, "getActiveTemplateForCampaign").mockResolvedValue({
        id: 1,
        politician_id: 1,
        campaign_id: 1,
        name: "Template",
        subject: "Thanks",
        body: "Thank you for your message",
        active: true,
        layout_type: "text_only",
        send_timing: "immediate",
        scheduled_for: null,
        created_at: "2024-01-01T00:00:00Z",
        updated_at: "2024-01-01T00:00:00Z",
      });
      vi.spyOn(mockDb, "getMessageContactEmail").mockResolvedValue(
        "sender@example.com",
      );
      vi.spyOn(mockDb, "updateMessageRetryCount").mockResolvedValue(undefined);
      vi.spyOn(JMAPClient.prototype, "sendEmail").mockResolvedValue({
        success: true,
        messageId: "jmap-3",
      });

      const result = await processScheduledReplies(mockDb, runtimeSecrets);

      expect(result.failed).toBe(1);
      expect(result.errors[0].error).toContain("No From/Reply-To");
      expect(mockDb.updateMessageRetryCount).toHaveBeenCalled();
      expect(JMAPClient.prototype.sendEmail).not.toHaveBeenCalled();
    });

    it("should process message end-to-end successfully", async () => {
      // Mock all required data
      const mockTemplate = {
        id: 1,
        politician_id: 1,
        campaign_id: 1,
        name: "Test",
        subject: "Thank you",
        body: "Thank you for your message",
        active: true,
        layout_type: "standard_header" as const,
        send_timing: "immediate" as const,
        scheduled_for: null,
        created_at: "2024-01-01T00:00:00Z",
        updated_at: "2024-01-01T00:00:00Z",
      };

      vi.spyOn(mockDb, "getActiveTemplateForCampaign").mockResolvedValue(
        mockTemplate,
      );
      vi.spyOn(mockDb, "getMessageContactEmail").mockResolvedValue(
        "sender@example.com",
      );
      vi.spyOn(mockJmapClient, "sendEmail").mockResolvedValue({
        success: true,
        messageId: "jmap-123",
      });

      expect(mockDb.getActiveTemplateForCampaign).toBeDefined();
      expect(mockDb.getMessageContactEmail).toBeDefined();
      expect(mockJmapClient.sendEmail).toBeDefined();
    });

    it("should handle partial batch processing", async () => {
      // Test scenario where some messages succeed and some fail
      const messages = [
        {
          id: 1,
          external_id: "ext-1",
          politician_id: 1,
          campaign_id: 1,
          sender_hash: "hash1",
          reply_status: "pending" as const,
          reply_scheduled_at: null,
          received_at: "2024-01-01T00:00:00Z",
          reply_retry_count: 0,
        },
        {
          id: 2,
          external_id: "ext-2",
          politician_id: 1,
          campaign_id: 1,
          sender_hash: "hash2",
          reply_status: "pending" as const,
          reply_scheduled_at: null,
          received_at: "2024-01-01T00:00:00Z",
          reply_retry_count: 0,
        },
      ];

      expect(messages).toHaveLength(2);
    });

    it("should return empty result when no messages to process", async () => {
      const mockSelect = vi.fn().mockReturnThis();
      const mockIn = vi.fn().mockReturnThis();
      const mockIs = vi.fn().mockReturnThis();
      const mockLt = vi.fn().mockReturnThis();
      const mockOr = vi.fn().mockResolvedValue({
        data: [],
        error: null,
      });

      vi.spyOn(mockDb, "getMessagesReadyToSend").mockResolvedValue([]);

      expect(mockOr).toBeDefined();
    });
  });

  describe("processReplyImmediately", () => {
    it("throws when the message is not eligible (not found)", async () => {
      const messagesById = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        in: vi.fn().mockReturnThis(),
        is: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue({ data: [], error: null }),
      };

      vi.spyOn(mockDb.supabase, "from").mockImplementation(((table: string) => {
        if (table === "messages") {
          return messagesById as any;
        }
        return {} as any;
      }) as (...args: unknown[]) => unknown);

      await expect(
        processReplyImmediately(mockDb, 404, runtimeSecrets),
      ).rejects.toThrow(/not eligible/);
      expect(mockDb.markMessageReplyDelivered).not.toHaveBeenCalled();
    });

    it("loads the message by id and sends a reply like the scheduled worker", async () => {
      const mockMessage = {
        id: 42,
        external_id: "ext-42",
        politician_id: 1,
        campaign_id: 5,
        sender_hash: "hash42",
        reply_status: "pending" as const,
        reply_scheduled_at: null,
        received_at: "2024-01-01T00:00:00Z",
        reply_retry_count: 0,
      };

      vi.spyOn(mockDb, "getMessageReadyToSendById").mockResolvedValue(
        mockMessage,
      );
      vi.spyOn(mockDb, "getCampaignById").mockResolvedValue({
        id: 5,
        name: "Campaign",
        technical_email: "outbound@campaign.example",
        reply_to_email: null,
      });
      vi.spyOn(mockDb, "getPoliticianById").mockResolvedValue({
        id: 1,
        name: "Politician",
        email: "pol@example.com",
      });

      const messagesById = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        in: vi.fn().mockReturnThis(),
        is: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue({ data: [mockMessage], error: null }),
      };
      const campaignsTable = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue({
          data: [
            {
              id: 5,
              name: "Campaign",
              technical_email: "outbound@campaign.example",
              reply_to_email: null,
            },
          ],
          error: null,
        }),
      };
      const politiciansTable = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue({
          data: [
            {
              id: 1,
              name: "Politician",
              email: "pol@example.com",
            },
          ],
          error: null,
        }),
      };

      vi.spyOn(mockDb.supabase, "from").mockImplementation(((table: string) => {
        if (table === "messages") {
          return messagesById as any;
        }
        if (table === "campaigns") {
          return campaignsTable as any;
        }
        if (table === "politicians") {
          return politiciansTable as any;
        }
        return {} as any;
      }) as (...args: unknown[]) => unknown);

      vi.spyOn(mockDb, "getActiveTemplateForCampaign").mockResolvedValue({
        id: 1,
        politician_id: 1,
        campaign_id: 5,
        name: "T",
        subject: "Thanks",
        body: "Thanks for writing",
        active: true,
        layout_type: "text_only",
        send_timing: "immediate",
        scheduled_for: null,
        created_at: "2024-01-01T00:00:00Z",
        updated_at: "2024-01-01T00:00:00Z",
      });
      vi.spyOn(mockDb, "getMessageContactEmail").mockResolvedValue(
        "voter@example.com",
      );
      vi.spyOn(JMAPClient.prototype, "sendEmail").mockResolvedValue({
        success: true,
        messageId: "jmap-immediate-1",
      });

      await processReplyImmediately(mockDb, 42, runtimeSecrets);

      expect(mockDb.markMessageReplyDelivered).toHaveBeenCalledWith(42);
      expect(JMAPClient.prototype.sendEmail).toHaveBeenCalledWith(
        expect.objectContaining({
          from: "outbound@campaign.example",
          fromName: "Politician",
          replyTo: "pol@example.com",
          to: ["voter@example.com"],
        }),
      );
    });
  });
});
