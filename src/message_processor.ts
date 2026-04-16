import { type DatabaseClient, hashEmail, type MessageInsert } from "./database";
import {
  formatEmailContentForEmbedding,
  generateEmbedding,
} from "./embedding_service";
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

    if (existingMessage.campaigns) {
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
      campaign_id: campaignId ?? undefined,
      campaign_name: campaignName ?? undefined,
      duplicate_rank: existingMessage.duplicate_rank,
      errors: [`Message with external_id ${data.external_id} already exists`],
    };
  }

  // 3. Embedding
  const body = data.text_content || data.message;
  const textForEmbedding = formatEmailContentForEmbedding(data.subject, body);
  const embedding = await generateEmbedding(ai, textForEmbedding);

  // 4. Storage (PRIVACY: only metadata, no PII)
  // Use sender_email ONLY to generate hash, then discard it
  const senderHash = await hashEmail(data.sender_email);

  // Insert message first without campaign/cluster assignment
  const messageData: MessageInsert = {
    external_id: data.external_id,
    channel: "api",
    channel_source: data.channel_source || "unknown",
    politician_id: politician.id,
    sender_hash: senderHash,
    campaign_id: null as any, // Will be set by classification
    classification_confidence: 0, // Will be updated by classification
    message_embedding: embedding,
    language: "auto",
    received_at: data.timestamp,
    duplicate_rank: 0, // Will be updated after classification
    processing_status: "processed",
    reply_status: null,
    reply_scheduled_at: null,
    sender_flag: data.sender_flag,
    is_reply: data.is_reply,
    stalwart_message_id: undefined,
    stalwart_account_id: undefined,
  };

  const messageId = await db.insertMessage(messageData);

  // 5. Unified classification and cluster assignment
  const classification = await db.classifyAndAssignToCluster(
    messageId,
    embedding,
    politician.id,
    data.campaign_hint,
  );

  // 6. Update duplicate rank if message has a campaign assigned
  let duplicateRank = 0;
  if (classification.campaign_id !== null) {
    duplicateRank = await db.getDuplicateRank(
      senderHash,
      politician.id,
      classification.campaign_id,
    );
    // Update the message with the duplicate rank
    await db.updateMessageFields(messageId, {
      duplicate_rank: duplicateRank,
      classification_confidence: classification.confidence,
    });

    // Ensure supporter audience is built from inbound messages,
    // so broadcast sends can target campaign supporters even before any reply send.
    await db.upsertSupporter(
      classification.campaign_id,
      politician.id,
      senderHash,
      data.timestamp,
    );

    await db.storeMessageContact({
      messageId,
      senderHash,
      senderEmail: data.sender_email,
      senderName: data.sender_name,
      capturedAt: data.timestamp,
    });
  }

  // 7. Determine reply scheduling (only for first message from sender with campaign)
  let replySchedule = null;
  if (duplicateRank === 0 && classification.campaign_id !== null) {
    // Get active template for this campaign to determine send_timing
    const activeTemplate = await db.getActiveTemplateForCampaign(
      classification.campaign_id,
    );

    if (activeTemplate) {
      replySchedule = calculateReplySchedule(
        activeTemplate.send_timing as
          | "immediate"
          | "office_hours"
          | "scheduled",
        activeTemplate.scheduled_for,
        data.timestamp,
      );
      // Update reply status
      await db.updateMessageFields(messageId, {
        reply_status: replySchedule.reply_status,
        reply_scheduled_at: replySchedule.reply_scheduled_at,
      });
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
    campaign_id: classification.campaign_id ?? undefined,
    campaign_name: classification.campaign_name ?? undefined,
    confidence: classification.confidence,
    duplicate_rank: duplicateRank,
    reply_status: replySchedule?.reply_status || null,
    reply_scheduled_at: replySchedule?.reply_scheduled_at || null,
    send_immediately: replySchedule?.send_immediately || false,
  };
}
