import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  processMessage,
  MessageInput,
  PoliticianNotFoundError,
} from "../src/message_processor";
import { DatabaseClient } from "../src/database";

// Mock DatabaseClient
const mockDb = {
  getMessageByExternalId: vi.fn(),
  findPoliticianByEmail: vi.fn(),
  classifyMessage: vi.fn(),
  getDuplicateRank: vi.fn(),
  insertMessage: vi.fn(),
} as unknown as DatabaseClient;

// Mock Ai
const mockAi = {
  run: vi.fn(),
};

describe("message_processor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const validInput: MessageInput = {
    external_id: "ext-123",
    sender_name: "John Doe",
    sender_email: "john@example.com",
    recipient_email: "jane@politician.com",
    subject: "Subject",
    message: "Message content",
    timestamp: "2023-01-01T00:00:00Z",
  };

  it("should return duplicate status if external_id exists", async () => {
    vi.spyOn(mockDb, "findPoliticianByEmail").mockResolvedValue({
      id: 1,
      name: "Test Politician",
    } as any);

    vi.spyOn(mockDb, "getMessageByExternalId").mockResolvedValue({
      id: 1,
      campaign_id: 2,
      duplicate_rank: 5,
      campaigns: { id: 2, name: "Existing Campaign" },
    } as any);

    const result = await processMessage(mockDb, mockAi as any, validInput);

    expect(result.success).toBe(false);
    expect(result.status).toBe("duplicate");
    expect(result.campaign_id).toBe(2);
    expect(result.campaign_name).toBe("Existing Campaign");
    expect(mockDb.getMessageByExternalId).toHaveBeenCalledWith(
      "ext-123",
      "unknown",
    );
  });

  it("should throw PoliticianNotFoundError if recipient not found", async () => {
    vi.spyOn(mockDb, "findPoliticianByEmail").mockResolvedValue(null);

    await expect(
      processMessage(mockDb, mockAi as any, validInput),
    ).rejects.toThrow(PoliticianNotFoundError);
  });

  it("should process message successfully", async () => {
    vi.spyOn(mockDb, "getMessageByExternalId").mockResolvedValue(null);
    vi.spyOn(mockDb, "findPoliticianByEmail").mockResolvedValue({
      id: 1,
    } as any);
    vi.spyOn(mockAi, "run").mockResolvedValue({ data: [[0.1, 0.2]] });
    vi.spyOn(mockDb, "classifyMessage").mockResolvedValue({
      campaign_id: 10,
      campaign_name: "Test Campaign",
      confidence: 0.9,
    });
    vi.spyOn(mockDb, "getDuplicateRank").mockResolvedValue(0);
    vi.spyOn(mockDb, "insertMessage").mockResolvedValue(100);

    const result = await processMessage(mockDb, mockAi as any, validInput);

    expect(result.success).toBe(true);
    expect(result.status).toBe("processed");
    expect(result.message_id).toBe(100);
    expect(result.campaign_id).toBe(10);
    expect(mockAi.run).toHaveBeenCalled();
    expect(mockDb.insertMessage).toHaveBeenCalled();
  });
});
