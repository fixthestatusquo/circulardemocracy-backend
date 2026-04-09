import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the embedding service to avoid ONNX runtime issues
vi.mock("../src/embedding_service", () => ({
  generateEmbedding: vi.fn().mockResolvedValue(new Array(1024).fill(0.1)),
  formatEmailContentForEmbedding: vi.fn().mockReturnValue("# Test Subject\n\nTest message body"),
}));

// Import modules to test
import {
  calculateReplySchedule,
  isInOfficeHours,
  getNextOfficeHourSlot,
  isReadyToSend,
} from "../src/scheduling";
import { renderEmailLayout } from "../src/email_layout";
import {
  validateTemplateData,
  createReplyTemplate,
  updateReplyTemplate,
} from "../src/template_service";
import {
  processMessage,
  MessageInput,
} from "../src/message_processor";
import { processScheduledReplies } from "../src/reply_worker";
import { DatabaseClient } from "../src/database";
import { JMAPClient } from "../src/jmap_client";

// =============================================================================
// SCHEDULING TESTS
// =============================================================================

describe("Scheduling", () => {
  describe("calculateReplySchedule", () => {
    describe("immediate mode", () => {
      it("should send immediately regardless of time", () => {
        const result = calculateReplySchedule(
          "immediate",
          null,
          "2024-01-15T22:00:00Z",
        );

        expect(result.reply_status).toBe("pending");
        expect(result.reply_scheduled_at).toBeNull();
        expect(result.send_immediately).toBe(true);
      });
    });

    describe("office_hours mode", () => {
      it("should send immediately during office hours", () => {
        const result = calculateReplySchedule(
          "office_hours",
          null,
          "2024-01-15T08:00:00Z",
        );

        expect(result.reply_status).toBe("pending");
        expect(result.reply_scheduled_at).toBeNull();
        expect(result.send_immediately).toBe(true);
      });

      it("should schedule for next day when after office hours", () => {
        const result = calculateReplySchedule(
          "office_hours",
          null,
          "2024-01-15T18:00:00Z",
        );

        expect(result.reply_status).toBe("scheduled");
        expect(result.reply_scheduled_at).not.toBeNull();
        expect(result.send_immediately).toBe(false);

        const scheduledDate = new Date(result.reply_scheduled_at!);
        expect(scheduledDate.getUTCDate()).toBe(16);
      });

      it("should schedule for Monday when received on Friday night", () => {
        const result = calculateReplySchedule(
          "office_hours",
          null,
          "2024-01-19T18:00:00Z",
        );

        expect(result.reply_status).toBe("scheduled");
        expect(result.send_immediately).toBe(false);
        expect(result.reply_scheduled_at).not.toBeNull();
        const scheduledDate = new Date(result.reply_scheduled_at!);
        expect(scheduledDate.getUTCDay()).toBe(1);
      });

      it("should schedule for Monday when received on Saturday", () => {
        const result = calculateReplySchedule(
          "office_hours",
          null,
          "2024-01-20T12:00:00Z",
        );

        expect(result.reply_status).toBe("scheduled");
        const scheduledDate = new Date(result.reply_scheduled_at!);
        expect(scheduledDate.getUTCDay()).toBe(1);
      });

      it("should schedule same-day 08:00 when received early morning", () => {
        const result = calculateReplySchedule(
          "office_hours",
          null,
          "2024-01-15T05:00:00Z",
        );

        expect(result.reply_status).toBe("scheduled");
        expect(result.send_immediately).toBe(false);
        expect(result.reply_scheduled_at).not.toBeNull();
        const scheduledDate = new Date(result.reply_scheduled_at!);
        expect(scheduledDate.getUTCDay()).toBe(1);
      });
    });

    describe("scheduled mode", () => {
      it("should use the provided scheduled_for timestamp", () => {
        const scheduledFor = "2024-02-01T10:00:00Z";
        const result = calculateReplySchedule(
          "scheduled",
          scheduledFor,
          "2024-01-15T12:00:00Z",
        );

        expect(result.reply_status).toBe("scheduled");
        expect(result.reply_scheduled_at).toContain("2024-02-01T10:00:00");
        expect(result.send_immediately).toBe(false);
      });

      it("should throw error if scheduled_for is missing", () => {
        expect(() => {
          calculateReplySchedule("scheduled", null, "2024-01-15T12:00:00Z");
        }).toThrow("scheduled_for is required");
      });

      it("should throw error if scheduled_for is in the past", () => {
        expect(() => {
          calculateReplySchedule(
            "scheduled",
            "2024-01-01T10:00:00Z",
            "2024-01-15T12:00:00Z",
          );
        }).toThrow("scheduled_for must be in the future");
      });
    });
  });

  describe("isInOfficeHours", () => {
    it("should return true for Monday 10:00 CEST", () => {
      const date = new Date("2024-01-15T08:00:00Z");
      expect(isInOfficeHours(date)).toBe(true);
    });

    it("should return false for Monday 20:00 CEST", () => {
      const date = new Date("2024-01-15T18:00:00Z");
      expect(isInOfficeHours(date)).toBe(false);
    });

    it("should return false for Saturday", () => {
      const date = new Date("2024-01-20T10:00:00Z");
      expect(isInOfficeHours(date)).toBe(false);
    });
  });

  describe("isReadyToSend", () => {
    it("should return true if scheduledAt is null", () => {
      expect(isReadyToSend(null)).toBe(true);
    });

    it("should return true if scheduled time has passed", () => {
      const pastDate = new Date(Date.now() - 1000 * 60 * 60).toISOString();
      expect(isReadyToSend(pastDate)).toBe(true);
    });

    it("should return false if scheduled time is in future", () => {
      const futureDate = new Date(Date.now() + 1000 * 60 * 60).toISOString();
      expect(isReadyToSend(futureDate)).toBe(false);
    });
  });
});

// =============================================================================
// EMAIL LAYOUT TESTS
// =============================================================================

describe("Email Layout", () => {
  describe("text_only layout", () => {
    it("should render plain text only without HTML", () => {
      const result = renderEmailLayout({
        subject: "Test Subject",
        markdown_body: "# Hello\n\nThis is **bold** text.",
        layout_type: "text_only",
      });

      expect(result.subject).toBe("Test Subject");
      expect(result.textBody).toContain("Hello");
      expect(result.textBody).toContain("This is bold text");
      expect(result.htmlBody).toBeUndefined();
    });

    it("should strip markdown formatting in text body", () => {
      const result = renderEmailLayout({
        subject: "Test",
        markdown_body: "**Bold** and *italic*",
        layout_type: "text_only",
      });

      expect(result.textBody).not.toContain("**");
      expect(result.textBody).not.toContain("*");
      expect(result.textBody).toContain("Bold");
      expect(result.textBody).toContain("italic");
    });
  });

  describe("standard_header layout", () => {
    it("should render both HTML and text versions", () => {
      const result = renderEmailLayout({
        subject: "Test Subject",
        markdown_body: "# Hello\n\nThis is a test.",
        layout_type: "standard_header",
      });

      expect(result.subject).toBe("Test Subject");
      expect(result.textBody).toBeTruthy();
      expect(result.htmlBody).toBeTruthy();
    });

    it("should include campaign name in header", () => {
      const result = renderEmailLayout({
        subject: "Test",
        markdown_body: "Content",
        layout_type: "standard_header",
        campaign_name: "Climate Action",
      });

      expect(result.htmlBody).toContain("Climate Action");
      expect(result.textBody).toContain("Climate Action");
    });

    it("should include politician info in header", () => {
      const result = renderEmailLayout({
        subject: "Test",
        markdown_body: "Content",
        layout_type: "standard_header",
        politician_name: "Jane Doe",
        politician_email: "jane@example.com",
      });

      expect(result.htmlBody).toContain("Jane Doe");
      expect(result.htmlBody).toContain("jane@example.com");
    });

    it("should convert markdown to HTML", () => {
      const result = renderEmailLayout({
        subject: "Test",
        markdown_body: "# Heading\n\n**Bold**",
        layout_type: "standard_header",
      });

      expect(result.htmlBody).toContain("<h1>");
      expect(result.htmlBody).toContain("Heading");
      expect(result.htmlBody).toContain("<strong>");
      expect(result.htmlBody).toContain("Bold");
    });

    it("should escape HTML in campaign name", () => {
      const result = renderEmailLayout({
        subject: "Test",
        markdown_body: "Content",
        layout_type: "standard_header",
        campaign_name: "<script>alert('xss')</script>",
      });

      expect(result.htmlBody).not.toContain("<script>alert");
      expect(result.htmlBody).toContain("&lt;script&gt;");
    });
  });
});

// =============================================================================
// TEMPLATE SERVICE TESTS
// =============================================================================

describe("Template Service", () => {
  describe("validateTemplateData", () => {
    it("should pass validation for valid template data", () => {
      const data = {
        politician_id: 1,
        campaign_id: 1,
        name: "Test Template",
        subject: "Test Subject",
        body: "This is a valid markdown body with enough content.",
        layout_type: "standard_header" as const,
        send_timing: "office_hours" as const,
        active: true,
      };

      const errors = validateTemplateData(data);
      expect(errors).toHaveLength(0);
    });

    it("should reject empty markdown body", () => {
      const data = {
        politician_id: 1,
        campaign_id: 1,
        name: "Test",
        subject: "Test",
        body: "   ",
        layout_type: "text_only" as const,
        send_timing: "immediate" as const,
        active: true,
      };

      const errors = validateTemplateData(data);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0].field).toBe("body");
    });

    it("should reject markdown with dangerous content", () => {
      const data = {
        politician_id: 1,
        campaign_id: 1,
        name: "Test",
        subject: "Test",
        body: "Valid content <script>alert('xss')</script>",
        layout_type: "text_only" as const,
        send_timing: "immediate" as const,
        active: true,
      };

      const errors = validateTemplateData(data);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0].field).toBe("body");
    });

    it("should require scheduled_for when send_timing is scheduled", () => {
      const data = {
        politician_id: 1,
        campaign_id: 1,
        name: "Test",
        subject: "Test",
        body: "Valid content",
        layout_type: "text_only" as const,
        send_timing: "scheduled" as const,
        active: true,
      };

      const errors = validateTemplateData(data);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors.some((e) => e.field === "scheduled_for")).toBe(true);
    });
  });

  describe("createReplyTemplate", () => {
    const mockDb = {
      deactivateOtherTemplates: vi.fn(),
      request: vi.fn(),
    } as unknown as DatabaseClient;

    beforeEach(() => {
      vi.clearAllMocks();
    });

    it("should create template successfully", async () => {
      const templateData = {
        politician_id: 1,
        campaign_id: 1,
        name: "Test Template",
        subject: "Thank you",
        body: "Thank you for your message.",
        layout_type: "standard_header" as const,
        send_timing: "office_hours" as const,
        active: true,
      };

      const mockCreatedTemplate = {
        id: 1,
        ...templateData,
        created_at: "2024-01-01T00:00:00Z",
        updated_at: "2024-01-01T00:00:00Z",
      };

      vi.spyOn(mockDb, "deactivateOtherTemplates").mockResolvedValue(undefined);
      vi.spyOn(mockDb, "request").mockResolvedValue([mockCreatedTemplate]);

      const result = await createReplyTemplate(mockDb, templateData);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.template.id).toBe(1);
      }
    });

    it("should return validation errors for invalid data", async () => {
      const invalidData = {
        politician_id: 1,
        campaign_id: 1,
        name: "Test",
        subject: "Test",
        body: "   ",
        layout_type: "text_only" as const,
        send_timing: "immediate" as const,
        active: true,
      };

      const result = await createReplyTemplate(mockDb, invalidData);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.errors.length).toBeGreaterThan(0);
      }
    });
  });

  describe("updateReplyTemplate", () => {
    const mockDb = {
      getReplyTemplateById: vi.fn(),
      deactivateOtherTemplates: vi.fn(),
      updateReplyTemplate: vi.fn(),
    } as unknown as DatabaseClient;

    beforeEach(() => {
      vi.clearAllMocks();
    });

    it("should deactivate others when activating template", async () => {
      vi.spyOn(mockDb, "getReplyTemplateById").mockResolvedValue({
        id: 10,
        politician_id: 1,
        campaign_id: 1,
        name: "Existing",
        subject: "Hi",
        body: "Body",
        active: false,
        layout_type: "text_only",
        send_timing: "immediate",
        scheduled_for: null,
        created_at: "2024-01-01T00:00:00Z",
        updated_at: "2024-01-01T00:00:00Z",
      } as any);
      vi.spyOn(mockDb, "deactivateOtherTemplates").mockResolvedValue(undefined);
      vi.spyOn(mockDb, "updateReplyTemplate").mockResolvedValue({
        id: 10,
        politician_id: 1,
        campaign_id: 1,
        name: "Existing",
        subject: "Hi",
        body: "Body",
        active: true,
        layout_type: "text_only",
        send_timing: "immediate",
        scheduled_for: null,
        created_at: "2024-01-01T00:00:00Z",
        updated_at: "2024-01-01T00:00:00Z",
      } as any);

      const result = await updateReplyTemplate(mockDb, 10, { active: true });

      expect(result.success).toBe(true);
      expect(mockDb.deactivateOtherTemplates).toHaveBeenCalledWith(1, 10);
    });
  });
});

// =============================================================================
// MESSAGE PROCESSOR INTEGRATION TESTS
// =============================================================================

describe("Message Processor Auto-Reply", () => {
  const mockDb = {
    getMessageByExternalId: vi.fn(),
    findPoliticianByEmail: vi.fn(),
    classifyMessage: vi.fn(),
    getDuplicateRank: vi.fn(),
    insertMessage: vi.fn(),
    getActiveTemplateForCampaign: vi.fn(),
    storeSenderEmail: vi.fn(),
    assignMessageToCluster: vi.fn(),
  } as unknown as DatabaseClient;

  const mockAi = {
    run: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  const validInput: MessageInput = {
    external_id: "ext-123",
    sender_name: "John Doe",
    sender_email: "john@example.com",
    recipient_email: "jane@politician.com",
    subject: "Climate Action",
    message: "I care about climate change",
    timestamp: "2024-01-15T10:00:00Z",
  };

  it("should schedule immediate reply when template has immediate timing", async () => {
    const immediateReplyHandler = vi.fn().mockResolvedValue(undefined);
    vi.spyOn(mockDb, "getMessageByExternalId").mockResolvedValue(null);
    vi.spyOn(mockDb, "findPoliticianByEmail").mockResolvedValue({
      id: 1,
      name: "Jane Politician",
    } as any);
    vi.spyOn(mockAi, "run").mockResolvedValue({ data: [[0.1, 0.2]] });
    vi.spyOn(mockDb, "classifyMessage").mockResolvedValue({
      campaign_id: 10,
      campaign_name: "Climate Action",
      confidence: 0.9,
    });
    vi.spyOn(mockDb, "getDuplicateRank").mockResolvedValue(0);
    vi.spyOn(mockDb, "getActiveTemplateForCampaign").mockResolvedValue({
      id: 1,
      campaign_id: 10,
      name: "Climate Response",
      subject: "Thank you",
      body: "Thank you for your message",
      active: true,
      layout_type: "standard_header",
      send_timing: "immediate",
      scheduled_for: null,
      created_at: "2024-01-01T00:00:00Z",
      updated_at: "2024-01-01T00:00:00Z",
    });
    vi.spyOn(mockDb, "insertMessage").mockResolvedValue(100);
    vi.spyOn(mockDb, "assignMessageToCluster").mockResolvedValue(1);
    vi.spyOn(mockDb, "storeSenderEmail").mockResolvedValue(undefined);

    const result = await processMessage(
      mockDb,
      mockAi as any,
      validInput,
      immediateReplyHandler,
    );

    expect(result.success).toBe(true);
    expect(result.reply_status).toBe("pending");
    expect(result.reply_scheduled_at).toBeNull();
    expect(result.send_immediately).toBe(true);
    expect(mockDb.storeSenderEmail).toHaveBeenCalledWith(
      100,
      expect.any(String),
      "john@example.com",
    );
    expect(immediateReplyHandler).toHaveBeenCalledWith(100);
  });

  it("should not schedule reply for duplicate messages", async () => {
    vi.spyOn(mockDb, "getMessageByExternalId").mockResolvedValue(null);
    vi.spyOn(mockDb, "findPoliticianByEmail").mockResolvedValue({
      id: 1,
    } as any);
    vi.spyOn(mockAi, "run").mockResolvedValue({ data: [[0.1, 0.2]] });
    vi.spyOn(mockDb, "classifyMessage").mockResolvedValue({
      campaign_id: 10,
      campaign_name: "Climate Action",
      confidence: 0.9,
    });
    vi.spyOn(mockDb, "getDuplicateRank").mockResolvedValue(1);
    vi.spyOn(mockDb, "insertMessage").mockResolvedValue(100);
    vi.spyOn(mockDb, "assignMessageToCluster").mockResolvedValue(1);
    vi.spyOn(mockDb, "storeSenderEmail").mockResolvedValue(undefined);

    const result = await processMessage(mockDb, mockAi as any, validInput);

    expect(result.success).toBe(true);
    expect(result.duplicate_rank).toBe(1);
    expect(result.reply_status).toBeNull();
    expect(mockDb.getActiveTemplateForCampaign).not.toHaveBeenCalled();
    expect(mockDb.storeSenderEmail).not.toHaveBeenCalled();
  });

  it("should not schedule reply if no active template exists", async () => {
    const immediateReplyHandler = vi.fn().mockResolvedValue(undefined);
    vi.spyOn(mockDb, "getMessageByExternalId").mockResolvedValue(null);
    vi.spyOn(mockDb, "findPoliticianByEmail").mockResolvedValue({
      id: 1,
    } as any);
    vi.spyOn(mockAi, "run").mockResolvedValue({ data: [[0.1, 0.2]] });
    vi.spyOn(mockDb, "classifyMessage").mockResolvedValue({
      campaign_id: 10,
      campaign_name: "Climate Action",
      confidence: 0.9,
    });
    vi.spyOn(mockDb, "getDuplicateRank").mockResolvedValue(0);
    vi.spyOn(mockDb, "getActiveTemplateForCampaign").mockResolvedValue(null);
    vi.spyOn(mockDb, "insertMessage").mockResolvedValue(100);
    vi.spyOn(mockDb, "assignMessageToCluster").mockResolvedValue(1);
    vi.spyOn(mockDb, "storeSenderEmail").mockResolvedValue(undefined);

    const result = await processMessage(
      mockDb,
      mockAi as any,
      validInput,
      immediateReplyHandler,
    );

    expect(result.success).toBe(true);
    expect(result.reply_status).toBeNull();
    expect(result.reply_scheduled_at).toBeNull();
    expect(mockDb.storeSenderEmail).not.toHaveBeenCalled();
    expect(immediateReplyHandler).not.toHaveBeenCalled();
  });
});
