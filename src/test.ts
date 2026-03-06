import { config } from "dotenv";
import { DatabaseClient } from "./database";
import {
  type Ai,
  type MessageInput,
  processMessage,
} from "./message_processor";

// Load environment variables
config();

// Mock AI Binding
const mockAI: Ai = {
  // biome-ignore lint/suspicious/noExplicitAny: AI inputs/outputs are dynamic
  run: async (model: string, _inputs: any) => {
    console.log(`[Mock AI] Running model: ${model}`);
    // Return mock response based on model
    if (model.includes("bge-m3")) {
      // Return embedding
      return {
        shape: [1, 3],
        data: [[0.1, 0.2, 0.3]], // Simplified embedding
      };
    }
    // Default fallback
    return { result: "mocked response" };
  },
};

// Mock Database Client
// We extend DatabaseClient to override methods for testing without real DB
class MockDatabaseClient extends DatabaseClient {
  constructor() {
    super({ url: "https://mock.supabase.co", key: "mock-key" });
  }

  async findPoliticianByEmail(email: string) {
    console.log(`[Mock DB] Finding politician: ${email}`);
    if (email === "politician@example.com") {
      return {
        id: 1,
        name: "Test Politician",
        email: email,
        additional_emails: [],
        active: true,
      };
    }
    return null;
  }

  async getMessageByExternalId(externalId: string, channelSource: string) {
    console.log(`[Mock DB] Checking duplicate: ${externalId}`);
    if (externalId === "duplicate-id") {
      return {
        id: 999,
        external_id: externalId,
        channel: "api",
        channel_source: channelSource,
        politician_id: 1,
        sender_hash: "hash",
        campaign_id: 2,
        classification_confidence: 0.9,
        message_embedding: [0.1],
        language: "en",
        received_at: new Date().toISOString(),
        duplicate_rank: 1,
        processing_status: "processed",
        // biome-ignore lint/suspicious/noExplicitAny: Mocking complex join result
        campaigns: { id: 2, name: "Existing Campaign" } as any,
      };
    }
    return null;
  }

  async classifyMessage(_embedding: number[], _campaignHint?: string) {
    console.log("[Mock DB] Classifying message");
    return {
      campaign_id: 10,
      campaign_name: "Test Campaign",
      confidence: 0.95,
    };
  }

  async getDuplicateRank(
    _senderHash: string,
    _politicianId: number,
    _campaignId: number,
  ) {
    console.log("[Mock DB] Getting duplicate rank");
    return 0;
  }

  // biome-ignore lint/suspicious/noExplicitAny: Mocking generic insert
  async insertMessage(data: any) {
    console.log("[Mock DB] Inserting message", data);
    return 12345;
  }
}

async function runTest() {
  console.log("Running manual test script...");

  const db = new MockDatabaseClient();
  const ai = mockAI;

  const validMessage: MessageInput = {
    external_id: `test-${Date.now()}`,
    sender_name: "Test User",
    sender_email: "user@example.com",
    recipient_email: "politician@example.com",
    subject: "Test Subject",
    message: "This is a test message for local processing.",
    timestamp: new Date().toISOString(),
  };

  try {
    console.log("\n--- Testing Valid Message ---");
    const result = await processMessage(db, ai, validMessage);
    console.log("Result:", JSON.stringify(result, null, 2));

    if (result.success && result.status === "processed") {
      console.log("✅ Valid message processed successfully");
    } else {
      console.error("❌ Valid message failed");
      process.exit(1);
    }
  } catch (error) {
    console.error("❌ Unexpected error:", error);
    process.exit(1);
  }

  try {
    console.log("\n--- Testing Politician Not Found ---");
    const invalidMessage = {
      ...validMessage,
      recipient_email: "unknown@example.com",
    };
    await processMessage(db, ai, invalidMessage);
    console.error("❌ Should have thrown PoliticianNotFoundError");
  } catch (error: any) {
    if (error.name === "PoliticianNotFoundError") {
      console.log("✅ Correctly threw PoliticianNotFoundError");
    } else {
      console.error("❌ Threw wrong error:", error);
    }
  }

  try {
    console.log("\n--- Testing Duplicate Message ---");
    const duplicateMessage = { ...validMessage, external_id: "duplicate-id" };
    const result = await processMessage(db, ai, duplicateMessage);
    console.log("Result:", JSON.stringify(result, null, 2));

    if (!result.success && result.status === "duplicate") {
      console.log("✅ Duplicate detected successfully");
    } else {
      console.error("❌ Duplicate detection failed");
    }
  } catch (error) {
    console.error("❌ Unexpected error during duplicate check:", error);
  }
}

runTest();
