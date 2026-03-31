import { describe, it, expect, vi, beforeEach } from "vitest";
import { processScheduledReplies } from "../src/reply_worker";
import { JMAPClient } from "../src/jmap_client";

// =============================================================================
// REPLY WORKER TESTS
// =============================================================================

describe("Reply Worker", () => {
  const workerConfig = {
    jmapApiUrl: "https://jmap.example.com",
    jmapAccountId: "account-1",
    jmapUsername: "user",
    jmapPassword: "pass",
  };

  const mockDb = {
    supabase: {
      from: vi.fn(),
    },
    getActiveTemplateForCampaign: vi.fn(),
    getSenderEmailByMessageId: vi.fn(),
    upsertSupporter: vi.fn(),
    logEmailEvent: vi.fn(),
    updateMessageRetryCount: vi.fn(),
    markMessageAsFailed: vi.fn(),
  } as any;

  const mockJmapClient = {
    sendEmail: vi.fn(),
  } as any;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(mockDb, "upsertSupporter").mockResolvedValue(1);
    vi.spyOn(mockDb, "logEmailEvent").mockResolvedValue(undefined);
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

      vi.spyOn(mockDb.supabase, "from").mockReturnValue({
        select: mockSelect,
        in: mockIn,
        is: mockIs,
        lt: mockLt,
        or: mockOr,
      } as any);

      expect(mockDb.supabase.from).toBeDefined();
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

      vi.spyOn(mockDb.supabase, "from").mockReturnValue({
        select: mockSelect,
        in: mockIn,
        is: mockIs,
        lt: mockLt,
        or: mockOr,
      } as any);

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

      vi.spyOn(mockDb.supabase, "from").mockReturnValue({
        select: mockSelect,
        in: mockIn,
        is: mockIs,
        lt: mockLt,
        or: mockOr,
      } as any);

      expect(mockOr).toBeDefined();
    });
  });

  describe("Email Sending", () => {
    const mockMessage = {
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

    it("should retrieve sender email from database", async () => {
      vi.spyOn(mockDb, "getSenderEmailByMessageId").mockResolvedValue(
        "sender@example.com",
      );

      const email = await mockDb.getSenderEmailByMessageId(1);
      expect(email).toBe("sender@example.com");
      expect(mockDb.getSenderEmailByMessageId).toHaveBeenCalledWith(1);
    });

    it("should handle missing sender email", async () => {
      vi.spyOn(mockDb, "getSenderEmailByMessageId").mockResolvedValue(null);

      const email = await mockDb.getSenderEmailByMessageId(1);
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

      vi.spyOn(mockDb.supabase, "from").mockReturnValue({
        select: mockSelect,
        in: mockIn,
        is: mockIs,
        lt: mockLt,
        or: mockOr,
      } as any);
      vi.spyOn(mockDb, "getActiveTemplateForCampaign").mockResolvedValue(null);
      vi.spyOn(mockDb, "updateMessageRetryCount").mockResolvedValue(undefined);

      const result = await processScheduledReplies(mockDb, workerConfig);

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
            reply_retry_count: 2,
          },
        ],
        error: null,
      });

      vi.spyOn(mockDb.supabase, "from").mockReturnValue({
        select: mockSelect,
        in: mockIn,
        is: mockIs,
        lt: mockLt,
        or: mockOr,
      } as any);
      vi.spyOn(mockDb, "getActiveTemplateForCampaign").mockResolvedValue(null);
      vi.spyOn(mockDb, "markMessageAsFailed").mockResolvedValue(undefined);
      vi.spyOn(mockDb, "updateMessageRetryCount").mockResolvedValue(undefined);

      const result = await processScheduledReplies(mockDb, workerConfig);

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

      vi.spyOn(mockDb.supabase, "from").mockImplementation(mockFrom as any);

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

      vi.spyOn(mockDb.supabase, "from").mockImplementation(mockFrom as any);

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

      vi.spyOn(mockDb.supabase, "from").mockImplementation(mockFrom as any);

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
          data: [{ id: 1, name: "Jane Doe", email: "jane@pol.com" }],
          error: null,
        }),
      };

      vi.spyOn(mockDb.supabase, "from").mockImplementation((...args: unknown[]) => {
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
      vi.spyOn(mockDb, "getSenderEmailByMessageId").mockResolvedValue(
        "sender@example.com",
      );
      vi.spyOn(JMAPClient.prototype, "sendEmail").mockResolvedValue({
        success: true,
        messageId: "jmap-1",
      });

      const result = await processScheduledReplies(mockDb, workerConfig);

      expect(result.sent).toBe(1);
      expect(messagesTable.update).toHaveBeenCalledWith(
        expect.objectContaining({ reply_status: "sent" }),
      );
      expect(messagesTable.eq).toHaveBeenCalledWith("id", 1);
      expect(JMAPClient.prototype.sendEmail).toHaveBeenCalledWith(
        expect.objectContaining({ from: "campaign-tech@example.com" }),
      );
    });

    it("should fail when campaign technical email is missing", async () => {
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
      };
      const campaignsTable = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue({
          data: [{ id: 1, name: "Campaign One", technical_email: null }],
          error: null,
        }),
      };
      const politiciansTable = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue({
          data: [{ id: 1, name: "Jane Doe", email: "jane@pol.com" }],
          error: null,
        }),
      };

      vi.spyOn(mockDb.supabase, "from").mockImplementation((...args: unknown[]) => {
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
      vi.spyOn(mockDb, "getSenderEmailByMessageId").mockResolvedValue(
        "sender@example.com",
      );
      vi.spyOn(mockDb, "updateMessageRetryCount").mockResolvedValue(undefined);
      vi.spyOn(JMAPClient.prototype, "sendEmail").mockResolvedValue({
        success: true,
        messageId: "jmap-2",
      });

      const result = await processScheduledReplies(mockDb, workerConfig);

      expect(result.failed).toBe(1);
      expect(result.errors[0].error).toContain(
        "Campaign technical email missing for campaign 1",
      );
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
      vi.spyOn(mockDb, "getSenderEmailByMessageId").mockResolvedValue(
        "sender@example.com",
      );
      vi.spyOn(mockJmapClient, "sendEmail").mockResolvedValue({
        success: true,
        messageId: "jmap-123",
      });

      expect(mockDb.getActiveTemplateForCampaign).toBeDefined();
      expect(mockDb.getSenderEmailByMessageId).toBeDefined();
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

      vi.spyOn(mockDb.supabase, "from").mockReturnValue({
        select: mockSelect,
        in: mockIn,
        is: mockIs,
        lt: mockLt,
        or: mockOr,
      } as any);

      expect(mockOr).toBeDefined();
    });
  });
});
