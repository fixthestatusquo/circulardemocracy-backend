import {
  type Campaign,
  type DatabaseClient,
  type MessageInsert,
  hashEmail,
} from "./database";

export class PoliticianNotFoundError extends Error {
  constructor(email: string) {
    super(`No politician found for email: ${email}`);
    this.name = "PoliticianNotFoundError";
  }
}

// Define Ai interface locally to avoid dependency issues if global type is not available
export interface Ai {
  // biome-ignore lint/suspicious/noExplicitAny: AI inputs/outputs are dynamic
  run(model: string, inputs: any): Promise<any>;
}

export interface MessageInput {
  external_id: string;
  sender_name: string;
  sender_email: string;
  recipient_email: string;
  subject: string;
  message: string;
  html_content?: string;
  text_content?: string;
  timestamp: string;
  channel_source?: string;
  campaign_hint?: string;
  sender_flag?: string;
  is_reply?: boolean;
}

export interface MessageProcessingResult {
  success: boolean;
  status: "processed" | "failed" | "politician_not_found" | "duplicate";
  message_id?: number;
  campaign_id?: number;
  campaign_name?: string;
  confidence?: number;
  duplicate_rank?: number;
  errors?: string[];
}

export async function processMessage(
  db: DatabaseClient,
  ai: Ai,
  data: MessageInput,
): Promise<MessageProcessingResult> {
  // 1. Politician Lookup
  const politician = await db.findPoliticianByEmail(data.recipient_email);
  if (!politician) {
    throw new PoliticianNotFoundError(data.recipient_email);
  }

  // 2. Duplicate Check
  const existingMessage = await db.getMessageByExternalId(
    data.external_id,
    data.channel_source || "unknown",
  );

  if (existingMessage) {
    // Determine campaign name safely
    let campaignName = "Unknown";
    let campaignId = existingMessage.campaign_id;

    // @ts-ignore - Handle Supabase join result structure
    if (existingMessage.campaigns) {
      // @ts-ignore
      const camp = Array.isArray(existingMessage.campaigns)
        ? existingMessage.campaigns[0]
        : existingMessage.campaigns;
      if (camp) {
        campaignName = camp.name;
        campaignId = camp.id;
      }
    }

    return {
      success: false,
      status: "duplicate",
      message_id: existingMessage.id,
      campaign_id: campaignId,
      campaign_name: campaignName,
      duplicate_rank: existingMessage.duplicate_rank,
      errors: [`Message with external_id ${data.external_id} already exists`],
    };
  }

  // 3. Embedding
  const textForEmbedding = data.text_content || data.message;
  const embedding = await generateEmbedding(ai, textForEmbedding);

  // 4. Classification
  const classification = await db.classifyMessage(
    embedding,
    data.campaign_hint,
  );

  // 5. Storage
  const senderHash = await hashEmail(data.sender_email);
  const duplicateRank = await db.getDuplicateRank(
    senderHash,
    politician.id,
    classification.campaign_id,
  );

  const messageData: MessageInsert = {
    external_id: data.external_id,
    channel: "api",
    channel_source: data.channel_source || "unknown",
    politician_id: politician.id,
    sender_hash: senderHash,
    campaign_id: classification.campaign_id,
    classification_confidence: classification.confidence,
    message_embedding: embedding,
    language: "auto",
    received_at: data.timestamp,
    duplicate_rank: duplicateRank,
    processing_status: "processed",
    sender_flag: data.sender_flag,
    is_reply: data.is_reply,
  };

  const messageId = await db.insertMessage(messageData);

  return {
    success: true,
    message_id: messageId,
    status: "processed",
    campaign_id: classification.campaign_id,
    campaign_name: classification.campaign_name,
    confidence: classification.confidence,
    duplicate_rank: duplicateRank,
  };
}

async function generateEmbedding(ai: Ai, text: string): Promise<number[]> {
  try {
    const response = await ai.run("@cf/baai/bge-m3", {
      text: text.substring(0, 8000), // Limit to avoid token limits
    });

    return response.data[0] as number[];
  } catch (error) {
    console.error("Embedding generation error:", error);
    throw new Error("Failed to generate message embedding");
  }
}
