import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the embedding service to avoid ONNX runtime issues
vi.mock("../src/embedding_service", () => ({
  generateEmbedding: vi.fn().mockResolvedValue(new Array(1024).fill(0.1)),
  formatEmailContentForEmbedding: vi.fn().mockReturnValue("# Test Subject\n\nTest message body"),
}));

import {
  adaptStalwartHookToMessageInput,
  mapToStalwartResponse,
  processStalwartHook,
  type StalwartHookPayload,
  type StalwartProcessingResult,
} from "../src/stalwart_adapter";
import { PoliticianNotFoundError } from "../src/message_processor";
import type { DatabaseClient } from "../src/database";

const mockDb = {
  getMessageByExternalId: vi.fn(),
  findPoliticianByEmail: vi.fn(),
  classifyMessage: vi.fn(),
  getDuplicateRank: vi.fn(),
  insertMessage: vi.fn(),
  getActiveTemplateForCampaign: vi.fn(),
  storeSenderEmail: vi.fn(),
} as unknown as DatabaseClient;

const mockAi = {
  run: vi.fn(),
};

const mockEnv = {
  AI: {
    run: vi.fn(),
  },
  SUPABASE_URL: "https://test.supabase.co",
  SUPABASE_KEY: "test-key",
  API_KEY: "test-api-key",
};

vi.mock("../src/database", () => ({
  DatabaseClient: vi.fn().mockImplementation(() => ({
    getMessageByExternalId: vi.fn().mockResolvedValue(null),
    findPoliticianByEmail: vi.fn().mockResolvedValue({
      id: 1,
      name: "Test Politician",
    }),
    classifyMessage: vi.fn().mockResolvedValue({
      campaign_id: 5,
      campaign_name: "Climate Action",
      confidence: 0.85,
    }),
    getDuplicateRank: vi.fn().mockResolvedValue(0),
    insertMessage: vi.fn().mockResolvedValue(100),
    getActiveTemplateForCampaign: vi.fn().mockResolvedValue(null),
    storeSenderEmail: vi.fn().mockResolvedValue(undefined),
  })),
  hashEmail: vi.fn().mockResolvedValue("hashed-email"),
}));

describe("Stalwart Webhook", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockEnv.AI.run.mockResolvedValue({ data: [[0.1, 0.2, 0.3]] });
  });

  describe("Schema Translation", () => {
    it("should extract sender from Reply-To header with priority", () => {
      const payload: StalwartHookPayload = {
        envelope: {
          from: "envelope@example.com",
          to: ["politician@gov.com"],
        },
        message: {
          headers: {
            "reply-to": "replyto@example.com",
            from: "From User <from@example.com>",
          },
          subject: "Test Subject",
          body: {
            text: "Test message",
          },
        },
        messageId: "msg-123",
        timestamp: 1678886400,
      };

      const result = adaptStalwartHookToMessageInput(payload);

      expect(result.messageInput.sender_email).toBe("replyto@example.com");
      expect(result.messageInput.recipient_email).toBe("politician@gov.com");
      expect(result.messageInput.subject).toBe("Test Subject");
      expect(result.messageInput.message).toBe("Test message");
      expect(result.messageInput.external_id).toBe("msg-123");
      expect(result.messageInput.channel_source).toBe("stalwart");
    });

    it("should extract sender from From header when Reply-To is absent", () => {
      const payload: StalwartHookPayload = {
        envelope: {
          from: "envelope@example.com",
          to: ["politician@gov.com"],
        },
        message: {
          headers: {
            from: "John Doe <john@example.com>",
          },
          subject: "Test",
          body: {
            text: "Message",
          },
        },
      };

      const result = adaptStalwartHookToMessageInput(payload);

      expect(result.messageInput.sender_email).toBe("john@example.com");
      expect(result.messageInput.sender_name).toBe("John Doe");
    });

    it("should fallback to envelope sender when headers are missing", () => {
      const payload: StalwartHookPayload = {
        envelope: {
          from: "envelope@example.com",
          to: ["politician@gov.com"],
        },
        message: {
          headers: {},
          subject: "Test",
        },
      };

      const result = adaptStalwartHookToMessageInput(payload);

      expect(result.messageInput.sender_email).toBe("envelope@example.com");
      expect(result.messageInput.sender_name).toBe("envelope");
    });

    it("should prefer HTML converted to Markdown over plain text", () => {
      const payload: StalwartHookPayload = {
        envelope: {
          from: "sender@example.com",
          to: ["politician@gov.com"],
        },
        message: {
          headers: {
            from: "sender@example.com",
          },
          subject: "Test",
          body: {
            text: "Plain text version",
            html: "<p>HTML <strong>version</strong> with <em>formatting</em></p>",
          },
        },
      };

      const result = adaptStalwartHookToMessageInput(payload);

      expect(result.messageInput.html_content).toBe("<p>HTML <strong>version</strong> with <em>formatting</em></p>");
      expect(result.messageInput.text_content).toBe("Plain text version");
      expect(result.messageInput.message).toBe("Plain text version");
    });

    it("should fallback to plain text when HTML is not available", () => {
      const payload: StalwartHookPayload = {
        envelope: {
          from: "sender@example.com",
          to: ["politician@gov.com"],
        },
        message: {
          headers: {
            from: "sender@example.com",
          },
          subject: "Test",
          body: {
            text: "Plain text only",
          },
        },
      };

      const result = adaptStalwartHookToMessageInput(payload);

      expect(result.messageInput.message).toBe("Plain text only");
    });

    it("should convert HTML links to Markdown", () => {
      const payload: StalwartHookPayload = {
        envelope: {
          from: "sender@example.com",
          to: ["politician@gov.com"],
        },
        message: {
          headers: {
            from: "sender@example.com",
          },
          subject: "Test",
          body: {
            html: '<a href="https://example.com">Click here</a>',
          },
        },
      };

      const result = adaptStalwartHookToMessageInput(payload);

      expect(result.messageInput.html_content).toBe('<a href="https://example.com">Click here</a>');
      expect(result.messageInput.message).toBe("");
    });

    it("should convert HTML headings to Markdown", () => {
      const payload: StalwartHookPayload = {
        envelope: {
          from: "sender@example.com",
          to: ["politician@gov.com"],
        },
        message: {
          headers: {
            from: "sender@example.com",
          },
          subject: "Test",
          body: {
            html: "<h1>Title</h1><h2>Subtitle</h2><p>Content</p>",
          },
        },
      };

      const result = adaptStalwartHookToMessageInput(payload);

      expect(result.messageInput.html_content).toContain("<h1>Title</h1>");
      expect(result.messageInput.html_content).toContain("<h2>Subtitle</h2>");
      expect(result.messageInput.message).toBe("");
    });

    it("should generate external_id when messageId is missing", () => {
      const payload: StalwartHookPayload = {
        envelope: {
          from: "sender@example.com",
          to: ["politician@gov.com"],
        },
        message: {
          headers: {
            from: "sender@example.com",
          },
          subject: "Test",
        },
      };

      const result = adaptStalwartHookToMessageInput(payload);

      expect(result.messageInput.external_id).toMatch(/^stalwart-\d+-[a-z0-9]+$/);
    });

    it("should generate timestamp when not provided", () => {
      const payload: StalwartHookPayload = {
        envelope: {
          from: "sender@example.com",
          to: ["politician@gov.com"],
        },
        message: {
          headers: {
            from: "sender@example.com",
          },
          subject: "Test",
        },
      };

      const result = adaptStalwartHookToMessageInput(payload);

      expect(result.messageInput.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    });

    it("should handle empty body gracefully", () => {
      const payload: StalwartHookPayload = {
        envelope: {
          from: "sender@example.com",
          to: ["politician@gov.com"],
        },
        message: {
          headers: {
            from: "sender@example.com",
          },
          subject: "Test",
          body: {},
        },
      };

      const result = adaptStalwartHookToMessageInput(payload);

      expect(result.messageInput.message).toBe("");
    });

    it("should handle missing body entirely", () => {
      const payload: StalwartHookPayload = {
        envelope: {
          from: "sender@example.com",
          to: ["politician@gov.com"],
        },
        message: {
          headers: {
            from: "sender@example.com",
          },
          subject: "Test",
        },
      };

      const result = adaptStalwartHookToMessageInput(payload);

      expect(result.messageInput.message).toBe("");
    });

    it("should extract email from complex From header formats", () => {
      const payload: StalwartHookPayload = {
        envelope: {
          from: "envelope@example.com",
          to: ["politician@gov.com"],
        },
        message: {
          headers: {
            from: '"John Doe" <john@example.com>',
          },
          subject: "Test",
        },
      };

      const result = adaptStalwartHookToMessageInput(payload);

      expect(result.messageInput.sender_email).toBe("john@example.com");
      expect(result.messageInput.sender_name).toBe("John Doe");
    });

    it("should handle HTML entities in converted markdown", () => {
      const payload: StalwartHookPayload = {
        envelope: {
          from: "sender@example.com",
          to: ["politician@gov.com"],
        },
        message: {
          headers: {
            from: "sender@example.com",
          },
          subject: "Test",
          body: {
            html: "<p>Test &amp; example &lt;tag&gt; &quot;quoted&quot;</p>",
          },
        },
      };

      const result = adaptStalwartHookToMessageInput(payload);

      expect(result.messageInput.html_content).toContain("&amp;");
      expect(result.messageInput.html_content).toContain("&lt;");
      expect(result.messageInput.html_content).toContain("&gt;");
      expect(result.messageInput.html_content).toContain("&quot;");
      expect(result.messageInput.message).toBe("");
    });
  });

  describe("Sender Flagging", () => {
    it("should flag as 'normal' when Reply-To is not present", () => {
      const payload: StalwartHookPayload = {
        envelope: {
          from: "sender@example.com",
          to: ["politician@gov.com"],
        },
        message: {
          headers: {
            from: "sender@example.com",
          },
          subject: "Test",
        },
      };

      const result = adaptStalwartHookToMessageInput(payload);

      expect(result.senderFlag).toBe("normal");
    });

    it("should flag as 'replyToDiffers' when Reply-To differs from both From and envelope", () => {
      const payload: StalwartHookPayload = {
        envelope: {
          from: "envelope@example.com",
          to: ["politician@gov.com"],
        },
        message: {
          headers: {
            "reply-to": "different@example.com",
            from: "sender@example.com",
          },
          subject: "Test",
        },
      };

      const result = adaptStalwartHookToMessageInput(payload);

      expect(result.senderFlag).toBe("replyToDiffers");
    });

    it("should flag as 'suspicious' when Reply-To differs only from envelope", () => {
      const payload: StalwartHookPayload = {
        envelope: {
          from: "envelope@example.com",
          to: ["politician@gov.com"],
        },
        message: {
          headers: {
            "reply-to": "sender@example.com",
            from: "sender@example.com",
          },
          subject: "Test",
        },
      };

      const result = adaptStalwartHookToMessageInput(payload);

      expect(result.senderFlag).toBe("suspicious");
    });

    it("should flag as 'normal' when Reply-To matches From", () => {
      const payload: StalwartHookPayload = {
        envelope: {
          from: "sender@example.com",
          to: ["politician@gov.com"],
        },
        message: {
          headers: {
            "reply-to": "sender@example.com",
            from: "sender@example.com",
          },
          subject: "Test",
        },
      };

      const result = adaptStalwartHookToMessageInput(payload);

      expect(result.senderFlag).toBe("normal");
    });

    it("should handle case-insensitive email comparison for flagging", () => {
      const payload: StalwartHookPayload = {
        envelope: {
          from: "Sender@Example.COM",
          to: ["politician@gov.com"],
        },
        message: {
          headers: {
            "reply-to": "sender@example.com",
            from: "SENDER@EXAMPLE.COM",
          },
          subject: "Test",
        },
      };

      const result = adaptStalwartHookToMessageInput(payload);

      expect(result.senderFlag).toBe("normal");
    });
  });

  describe("Campaign Hint Extraction", () => {
    it("should extract campaign hint from recipient email alias", () => {
      const payload: StalwartHookPayload = {
        envelope: {
          from: "sender@example.com",
          to: ["politician+climate@gov.com"],
        },
        message: {
          headers: {
            from: "sender@example.com",
          },
          subject: "Test",
        },
      };

      const result = adaptStalwartHookToMessageInput(payload);

      expect(result.messageInput.campaign_hint).toBe("climate");
    });

    it("should extract campaign hint from subject tag when alias not present", () => {
      const payload: StalwartHookPayload = {
        envelope: {
          from: "sender@example.com",
          to: ["politician@gov.com"],
        },
        message: {
          headers: {
            from: "sender@example.com",
          },
          subject: "[healthcare] Important issue",
        },
      };

      const result = adaptStalwartHookToMessageInput(payload);

      expect(result.messageInput.campaign_hint).toBe("healthcare");
    });

    it("should prioritize email alias over subject tag", () => {
      const payload: StalwartHookPayload = {
        envelope: {
          from: "sender@example.com",
          to: ["politician+climate@gov.com"],
        },
        message: {
          headers: {
            from: "sender@example.com",
          },
          subject: "[healthcare] Important issue",
        },
      };

      const result = adaptStalwartHookToMessageInput(payload);

      expect(result.messageInput.campaign_hint).toBe("climate");
    });

    it("should return undefined when no campaign hint is present", () => {
      const payload: StalwartHookPayload = {
        envelope: {
          from: "sender@example.com",
          to: ["politician@gov.com"],
        },
        message: {
          headers: {
            from: "sender@example.com",
          },
          subject: "Regular subject",
        },
      };

      const result = adaptStalwartHookToMessageInput(payload);

      expect(result.messageInput.campaign_hint).toBeUndefined();
    });

    it("should handle complex email aliases", () => {
      const payload: StalwartHookPayload = {
        envelope: {
          from: "sender@example.com",
          to: ["jane.doe+education-reform@parliament.gov"],
        },
        message: {
          headers: {
            from: "sender@example.com",
          },
          subject: "Test",
        },
      };

      const result = adaptStalwartHookToMessageInput(payload);

      expect(result.messageInput.campaign_hint).toBe("education-reform");
    });

    it("should extract first subject tag when multiple brackets present", () => {
      const payload: StalwartHookPayload = {
        envelope: {
          from: "sender@example.com",
          to: ["politician@gov.com"],
        },
        message: {
          headers: {
            from: "sender@example.com",
          },
          subject: "[climate] [urgent] Important issue",
        },
      };

      const result = adaptStalwartHookToMessageInput(payload);

      expect(result.messageInput.campaign_hint).toBe("climate");
    });
  });

  describe("Multiple Recipients", () => {
    it("should handle multiple recipients by using the first one", () => {
      const payload: StalwartHookPayload = {
        envelope: {
          from: "sender@example.com",
          to: ["first@gov.com", "second@gov.com", "third@gov.com"],
        },
        message: {
          headers: {
            from: "sender@example.com",
          },
          subject: "Test",
        },
      };

      const result = adaptStalwartHookToMessageInput(payload);

      expect(result.messageInput.recipient_email).toBe("first@gov.com");
    });

    it("should extract campaign hint from first recipient when multiple recipients", () => {
      const payload: StalwartHookPayload = {
        envelope: {
          from: "sender@example.com",
          to: ["politician+climate@gov.com", "other@gov.com"],
        },
        message: {
          headers: {
            from: "sender@example.com",
          },
          subject: "Test",
        },
      };

      const result = adaptStalwartHookToMessageInput(payload);

      expect(result.messageInput.campaign_hint).toBe("climate");
      expect(result.messageInput.recipient_email).toBe("politician+climate@gov.com");
    });
  });

  describe("Response Mapping", () => {
    it("should map successful processing to accept with campaign folder", () => {
      const result: StalwartProcessingResult = {
        success: true,
        status: "processed",
        message_id: 100,
        campaign_id: 5,
        campaign_name: "Climate Action",
        confidence: 0.85,
        duplicate_rank: 0,
        senderFlag: "normal",
      };

      const response = mapToStalwartResponse(result);

      expect(response.action).toBe("accept");
      expect(response.modifications?.folder).toBe("Climate Action/inbox");
    });

    it("should fail-open to campaign_hint/unprocessed when processing fails with hint", () => {
      const result: StalwartProcessingResult = {
        success: false,
        status: "failed",
        errors: ["Classification error"],
        senderFlag: "normal",
        campaign_hint: "climate",
      };

      const response = mapToStalwartResponse(result);

      expect(response.action).toBe("accept");
      expect(response.modifications?.folder).toBe("climate/unprocessed");
    });

    it("should fail-open to Inbox when processing fails without hint", () => {
      const result: StalwartProcessingResult = {
        success: false,
        status: "failed",
        errors: ["Classification error"],
        senderFlag: "normal",
      };

      const response = mapToStalwartResponse(result);

      expect(response.action).toBe("accept");
      expect(response.modifications).toBeUndefined();
    });

    it("should map duplicate to accept with campaign/Duplicates folder", () => {
      const result: StalwartProcessingResult = {
        success: false,
        status: "duplicate",
        message_id: 50,
        campaign_id: 3,
        campaign_name: "Healthcare Reform",
        duplicate_rank: 2,
        senderFlag: "normal",
      };

      const response = mapToStalwartResponse(result);

      expect(response.action).toBe("accept");
      expect(response.modifications?.folder).toBe("Healthcare Reform/Duplicates");
    });

    it("should map error to accept without folder (fail-open)", () => {
      const result: StalwartProcessingResult = {
        success: false,
        status: "failed",
        errors: ["Processing error"],
        senderFlag: "normal",
      };

      const response = mapToStalwartResponse(result);

      expect(response.action).toBe("accept");
      expect(response.modifications).toBeUndefined();
    });

    it("should handle successful processing without campaign name", () => {
      const result: StalwartProcessingResult = {
        success: true,
        status: "processed",
        message_id: 100,
        senderFlag: "normal",
      };

      const response = mapToStalwartResponse(result);

      expect(response.action).toBe("accept");
      expect(response.modifications).toBeUndefined();
    });

    it("should handle duplicate without campaign name", () => {
      const result: StalwartProcessingResult = {
        success: false,
        status: "duplicate",
        message_id: 50,
        senderFlag: "normal",
      };

      const response = mapToStalwartResponse(result);

      expect(response.action).toBe("accept");
      expect(response.modifications).toBeUndefined();
    });

    it("should preserve sender flag in result but not in response", () => {
      const result: StalwartProcessingResult = {
        success: true,
        status: "processed",
        message_id: 100,
        campaign_name: "Test Campaign",
        senderFlag: "replyToDiffers",
      };

      const response = mapToStalwartResponse(result);

      expect(response.action).toBe("accept");
      expect(response.modifications?.folder).toBe("Test Campaign/inbox");
      expect(response).not.toHaveProperty("senderFlag");
    });
  });

  describe("Integration Tests", () => {
    it("should process a complete Stalwart hook payload successfully", async () => {
      const payload: StalwartHookPayload = {
        envelope: {
          from: "citizen@example.com",
          to: ["politician+climate@gov.com"],
        },
        message: {
          headers: {
            from: "John Citizen <citizen@example.com>",
          },
          subject: "Climate Action Needed",
          body: {
            html: "<p>We need <strong>urgent</strong> action on climate change.</p>",
          },
        },
        messageId: "stalwart-msg-12345",
        timestamp: 1678886400,
      };

      vi.spyOn(mockDb, "getMessageByExternalId").mockResolvedValue(null);
      vi.spyOn(mockDb, "findPoliticianByEmail").mockResolvedValue({
        id: 1,
        name: "Jane Politician",
      } as any);
      vi.spyOn(mockAi, "run").mockResolvedValue({ data: [[0.1, 0.2, 0.3]] });
      vi.spyOn(mockDb, "classifyMessage").mockResolvedValue({
        campaign_id: 5,
        campaign_name: "Climate Action",
        confidence: 0.85,
      });
      vi.spyOn(mockDb, "getDuplicateRank").mockResolvedValue(0);
      vi.spyOn(mockDb, "insertMessage").mockResolvedValue(100);

      const result = await processStalwartHook(mockDb, mockAi as any, payload);

      expect(result.success).toBe(true);
      expect(result.status).toBe("processed");
      expect(result.message_id).toBe(100);
      expect(result.campaign_id).toBe(5);
      expect(result.campaign_name).toBe("Climate Action");
      expect(result.senderFlag).toBe("normal");

      expect(mockDb.insertMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          external_id: "stalwart-msg-12345",
          channel: "api",
          channel_source: "stalwart",
          politician_id: 1,
        }),
      );
    });

    it("should extract campaign hint from email alias and pass to processMessage", async () => {
      const payload: StalwartHookPayload = {
        envelope: {
          from: "citizen@example.com",
          to: ["politician+healthcare@gov.com"],
        },
        message: {
          headers: {
            from: "citizen@example.com",
          },
          subject: "Healthcare Issue",
          body: {
            text: "Healthcare needs improvement",
          },
        },
        messageId: "msg-123",
        timestamp: 1678886400,
      };

      vi.spyOn(mockDb, "getMessageByExternalId").mockResolvedValue(null);
      vi.spyOn(mockDb, "findPoliticianByEmail").mockResolvedValue({
        id: 1,
        name: "Politician",
      } as any);
      vi.spyOn(mockAi, "run").mockResolvedValue({ data: [[0.1, 0.2]] });
      vi.spyOn(mockDb, "classifyMessage").mockResolvedValue({
        campaign_id: 3,
        campaign_name: "Healthcare Reform",
        confidence: 0.9,
      });
      vi.spyOn(mockDb, "getDuplicateRank").mockResolvedValue(0);
      vi.spyOn(mockDb, "insertMessage").mockResolvedValue(50);

      await processStalwartHook(mockDb, mockAi as any, payload);

      expect(mockDb.classifyMessage).toHaveBeenCalledWith(
        expect.any(Array),
        1,
        "healthcare",
      );
    });

    it("should throw PoliticianNotFoundError when recipient not found", async () => {
      const payload: StalwartHookPayload = {
        envelope: {
          from: "citizen@example.com",
          to: ["unknown@gov.com"],
        },
        message: {
          headers: {
            from: "citizen@example.com",
          },
          subject: "Test",
          body: {
            text: "Test message",
          },
        },
      };

      vi.spyOn(mockDb, "findPoliticianByEmail").mockResolvedValue(null);

      await expect(
        processStalwartHook(mockDb, mockAi as any, payload),
      ).rejects.toThrow(PoliticianNotFoundError);
    });

    it("should return duplicate status when message already exists", async () => {
      const payload: StalwartHookPayload = {
        envelope: {
          from: "citizen@example.com",
          to: ["politician@gov.com"],
        },
        message: {
          headers: {
            from: "citizen@example.com",
          },
          subject: "Test",
          body: {
            text: "Test message",
          },
        },
        messageId: "duplicate-msg",
        timestamp: 1678886400,
      };

      vi.spyOn(mockDb, "findPoliticianByEmail").mockResolvedValue({
        id: 1,
        name: "Politician",
      } as any);
      vi.spyOn(mockDb, "getMessageByExternalId").mockResolvedValue({
        id: 99,
        campaign_id: 2,
        duplicate_rank: 3,
        campaigns: { id: 2, name: "Existing Campaign" },
      } as any);

      const result = await processStalwartHook(mockDb, mockAi as any, payload);

      expect(result.success).toBe(false);
      expect(result.status).toBe("duplicate");
      expect(result.message_id).toBe(99);
      expect(result.campaign_name).toBe("Existing Campaign");
      expect(result.senderFlag).toBe("normal");
    });

    it("should include campaign_hint in result for fail-open handling", async () => {
      const payload: StalwartHookPayload = {
        envelope: {
          from: "citizen@example.com",
          to: ["politician+climate@gov.com"],
        },
        message: {
          headers: {
            from: "citizen@example.com",
          },
          subject: "Climate Issue",
          body: {
            text: "Test message",
          },
        },
        messageId: "msg-with-hint",
        timestamp: 1678886400,
      };

      vi.spyOn(mockDb, "getMessageByExternalId").mockResolvedValue(null);
      vi.spyOn(mockDb, "findPoliticianByEmail").mockResolvedValue({
        id: 1,
        name: "Politician",
      } as any);
      vi.spyOn(mockAi, "run").mockResolvedValue({ data: [[0.1, 0.2]] });
      vi.spyOn(mockDb, "classifyMessage").mockResolvedValue({
        campaign_id: 5,
        campaign_name: "Climate Action",
        confidence: 0.8,
      });
      vi.spyOn(mockDb, "getDuplicateRank").mockResolvedValue(0);
      vi.spyOn(mockDb, "insertMessage").mockResolvedValue(100);

      const result = await processStalwartHook(mockDb, mockAi as any, payload);

      expect(result.campaign_hint).toBe("climate");
      expect(result.success).toBe(true);
    });
  });

  // Note: HTTP Endpoint tests have been removed as they depended on the deprecated
  // stalwart_hook.ts implementation. HTTP endpoint testing is now covered in
  // stalwart.test.ts which tests the active stalwart.ts implementation.
});
