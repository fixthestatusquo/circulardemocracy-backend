import { describe, it, expect, vi } from "vitest";
import {
  adaptStalwartHookToMessageInput,
  mapToStalwartResponse,
  type StalwartHookPayload,
  type StalwartProcessingResult,
} from "../src/stalwart_adapter";

// Mock the embedding service to avoid ONNX runtime issues
vi.mock("../src/embedding_service", () => ({
  generateEmbedding: vi.fn().mockResolvedValue(new Array(1024).fill(0.1)),
  formatEmailContentForEmbedding: vi.fn().mockReturnValue("# Test Subject\n\nTest message body"),
}));

describe("Stalwart Adapter - Reply Detection", () => {
  describe("detectReply via In-Reply-To header", () => {
    it("should detect reply when In-Reply-To header is present", () => {
      const payload: StalwartHookPayload = {
        envelope: {
          from: "sender@example.com",
          to: ["politician@gov.com"],
        },
        message: {
          headers: {
            from: "sender@example.com",
            "in-reply-to": "<original-message-id@example.com>",
          },
          subject: "Re: Important Issue",
          body: {
            text: "Thank you for your response",
          },
        },
      };

      const result = adaptStalwartHookToMessageInput(payload);

      expect(result.isReply).toBe(true);
      expect(result.messageInput.is_reply).toBe(true);
    });

    it("should detect reply when References header is present", () => {
      const payload: StalwartHookPayload = {
        envelope: {
          from: "sender@example.com",
          to: ["politician@gov.com"],
        },
        message: {
          headers: {
            from: "sender@example.com",
            references: "<msg1@example.com> <msg2@example.com>",
          },
          subject: "Re: Important Issue",
          body: {
            text: "Following up on this",
          },
        },
      };

      const result = adaptStalwartHookToMessageInput(payload);

      expect(result.isReply).toBe(true);
    });

    it("should detect reply when subject starts with Re:", () => {
      const payload: StalwartHookPayload = {
        envelope: {
          from: "sender@example.com",
          to: ["politician@gov.com"],
        },
        message: {
          headers: {
            from: "sender@example.com",
            subject: "Re: Climate Action",
          },
          body: {
            text: "I agree with your points",
          },
        },
      };

      const result = adaptStalwartHookToMessageInput(payload);

      expect(result.isReply).toBe(true);
    });

    it("should detect reply when subject starts with Fwd:", () => {
      const payload: StalwartHookPayload = {
        envelope: {
          from: "sender@example.com",
          to: ["politician@gov.com"],
        },
        message: {
          headers: {
            from: "sender@example.com",
            subject: "Fwd: Important Information",
          },
          body: {
            text: "Forwarding this to you",
          },
        },
      };

      const result = adaptStalwartHookToMessageInput(payload);

      expect(result.isReply).toBe(true);
    });

    it("should detect reply when subject starts with FW: (case insensitive)", () => {
      const payload: StalwartHookPayload = {
        envelope: {
          from: "sender@example.com",
          to: ["politician@gov.com"],
        },
        message: {
          headers: {
            from: "sender@example.com",
            subject: "fw: Important Information",
          },
          body: {
            text: "Forwarding this to you",
          },
        },
      };

      const result = adaptStalwartHookToMessageInput(payload);

      expect(result.isReply).toBe(true);
    });

    it("should NOT detect reply for new messages", () => {
      const payload: StalwartHookPayload = {
        envelope: {
          from: "sender@example.com",
          to: ["politician@gov.com"],
        },
        message: {
          headers: {
            from: "sender@example.com",
            subject: "New Issue to Discuss",
          },
          body: {
            text: "I have a new concern",
          },
        },
      };

      const result = adaptStalwartHookToMessageInput(payload);

      expect(result.isReply).toBe(false);
      expect(result.messageInput.is_reply).toBe(false);
    });

    it("should NOT detect reply when subject contains 'Re:' in middle", () => {
      const payload: StalwartHookPayload = {
        envelope: {
          from: "sender@example.com",
          to: ["politician@gov.com"],
        },
        message: {
          headers: {
            from: "sender@example.com",
            subject: "Regarding Re: Climate",
          },
          body: {
            text: "New message about climate",
          },
        },
      };

      const result = adaptStalwartHookToMessageInput(payload);

      expect(result.isReply).toBe(false);
    });
  });

  describe("Folder routing for replies", () => {
    it("should route replies to [campaign]/replied folder", () => {
      const result: StalwartProcessingResult = {
        success: true,
        status: "processed",
        message_id: 100,
        campaign_id: 5,
        campaign_name: "Climate Action",
        confidence: 0.85,
        duplicate_rank: 0,
        senderFlag: "normal",
        isReply: true,
      };

      const response = mapToStalwartResponse(result);

      expect(response.action).toBe("accept");
      expect(response.modifications?.folder).toBe("Climate Action/replied");
    });

    it("should route new messages to [campaign]/inbox folder", () => {
      const result: StalwartProcessingResult = {
        success: true,
        status: "processed",
        message_id: 100,
        campaign_id: 5,
        campaign_name: "Climate Action",
        confidence: 0.85,
        duplicate_rank: 0,
        senderFlag: "normal",
        isReply: false,
      };

      const response = mapToStalwartResponse(result);

      expect(response.action).toBe("accept");
      expect(response.modifications?.folder).toBe("Climate Action/inbox");
    });

    it("should route replies without isReply flag to inbox (default)", () => {
      const result: StalwartProcessingResult = {
        success: true,
        status: "processed",
        message_id: 100,
        campaign_id: 5,
        campaign_name: "Healthcare Reform",
        confidence: 0.9,
        duplicate_rank: 0,
        senderFlag: "normal",
      };

      const response = mapToStalwartResponse(result);

      expect(response.action).toBe("accept");
      expect(response.modifications?.folder).toBe("Healthcare Reform/inbox");
    });
  });

  describe("Sender flag persistence", () => {
    it("should include sender_flag in messageInput for persistence", () => {
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
          body: {
            text: "Test message",
          },
        },
      };

      const result = adaptStalwartHookToMessageInput(payload);

      expect(result.senderFlag).toBe("replyToDiffers");
      expect(result.messageInput.sender_flag).toBe("replyToDiffers");
    });

    it("should include normal sender_flag in messageInput", () => {
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
            text: "Test message",
          },
        },
      };

      const result = adaptStalwartHookToMessageInput(payload);

      expect(result.senderFlag).toBe("normal");
      expect(result.messageInput.sender_flag).toBe("normal");
    });

    it("should include suspicious sender_flag in messageInput", () => {
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
          body: {
            text: "Test message",
          },
        },
      };

      const result = adaptStalwartHookToMessageInput(payload);

      expect(result.senderFlag).toBe("suspicious");
      expect(result.messageInput.sender_flag).toBe("suspicious");
    });
  });
});
