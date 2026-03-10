import {
  type Campaign,
  type DatabaseClient,
  type MessageInsert,
  type ReplyTemplate,
  hashEmail,
} from "./database";
import { calculateReplySchedule } from "./scheduling";

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
  reply_status?: "pending" | "scheduled" | null;
  reply_scheduled_at?: string | null;
  send_immediately?: boolean;
  errors?: string[];
}

export type ImmediateReplyHandler = (messageId: number) => Promise<void>;

export async function processMessage(
  db: DatabaseClient,
  ai: Ai,
  data: MessageInput,
  immediateReplyHandler?: ImmediateReplyHandler,
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

  // 5. Storage (PRIVACY: only metadata, no PII)
  // Use sender_email ONLY to generate hash, then discard it
  const senderHash = await hashEmail(data.sender_email);
  const duplicateRank = await db.getDuplicateRank(
    senderHash,
    politician.id,
    classification.campaign_id,
  );

  // 6. Determine reply scheduling (only for first message from sender)
  let replySchedule = null;
  if (duplicateRank === 0) {
    // Get active template for this politician/campaign to determine send_timing
    const activeTemplate = await db.getActiveTemplateForCampaign(
      politician.id,
      classification.campaign_id,
    );

    if (activeTemplate) {
      replySchedule = calculateReplySchedule(
        activeTemplate.send_timing,
        activeTemplate.scheduled_for,
        data.timestamp,
      );
    }
  }

  // PRIVACY: API messages have no Stalwart references (stalwart_message_id = NULL)
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
    stalwart_message_id: undefined,
    stalwart_account_id: undefined,
    reply_status: replySchedule?.reply_status || null,
    reply_scheduled_at: replySchedule?.reply_scheduled_at || null,
  };

  const messageId = await db.insertMessage(messageData);

  // Store sender email if auto-reply is scheduled (only for first message from sender)
  if (replySchedule && duplicateRank === 0) {
    try {
      await db.storeSenderEmail(messageId, senderHash, data.sender_email);
    } catch (error) {
      console.error("Failed to store sender email for auto-reply:", error);
      // Don't fail the entire message processing if email storage fails
      // The message is still processed, just auto-reply won't work
    }
  }

  if (replySchedule?.send_immediately && immediateReplyHandler) {
    try {
      await immediateReplyHandler(messageId);
    } catch (error) {
      console.error("Immediate reply send failed:", error);
    }
  }

  return {
    success: true,
    message_id: messageId,
    status: "processed",
    campaign_id: classification.campaign_id,
    campaign_name: classification.campaign_name,
    confidence: classification.confidence,
    duplicate_rank: duplicateRank,
    reply_status: replySchedule?.reply_status || null,
    reply_scheduled_at: replySchedule?.reply_scheduled_at || null,
    send_immediately: replySchedule?.send_immediately || false,
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
