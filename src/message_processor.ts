import { type DatabaseClient, hashEmail, type MessageInsert } from "./database";
import {
  formatEmailContentForEmbedding,
  generateEmbedding,
} from "./embedding_service";
import {
  calculateReplySchedule,
  isReadyToSend,
  type ScheduleResult,
} from "./scheduling";

export class PoliticianNotFoundError extends Error {
  constructor(email: string) {
    super(`No politician found for email: ${email}`);
    this.name = "PoliticianNotFoundError";
  }
}

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
  reply_scheduled_at?: string | null;
  send_immediately?: boolean;
  errors?: string[];
}

export type ImmediateReplyHandler = (messageId: number) => Promise<void>;

/**
 * Applies send timing from the campaign's active template when the message is eligible:
 * campaign assigned, duplicate_rank 0, not yet sent. Returns null when no auto-reply applies.
 */
export async function applyReplyScheduleForMessage(
  db: DatabaseClient,
  messageId: number,
): Promise<ScheduleResult | null> {
  const row = await db.getMessageForReplyScheduling(messageId);
  if (!row || row.reply_sent_at) {
    return null;
  }
  if (row.campaign_id == null || row.duplicate_rank !== 0) {
    return null;
  }

  const activeTemplate = await db.getActiveTemplateForCampaign(row.campaign_id);
  if (!activeTemplate) {
    return null;
  }

  if (row.reply_scheduled_at && !isReadyToSend(row.reply_scheduled_at)) {
    return {
      reply_scheduled_at: row.reply_scheduled_at,
      send_immediately: false,
    };
  }

  const replySchedule = calculateReplySchedule(
    activeTemplate.send_timing as "immediate" | "office_hours" | "scheduled",
    activeTemplate.scheduled_for,
    row.received_at,
  );

  await db.updateMessageFields(messageId, {
    reply_scheduled_at: replySchedule.reply_scheduled_at,
  });

  return replySchedule;
}

export async function processMessage(
  db: DatabaseClient,
  ai: Ai,
  data: MessageInput,
  immediateReplyHandler?: ImmediateReplyHandler,
): Promise<MessageProcessingResult> {
  const politician = await db.findPoliticianByEmail(data.recipient_email);
  if (!politician) {
    throw new PoliticianNotFoundError(data.recipient_email);
  }

  const existingMessage = await db.getMessageByExternalId(
    data.external_id,
    data.channel_source || "unknown",
  );

  if (existingMessage) {
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

  const body = data.text_content || data.message;
  const textForEmbedding = formatEmailContentForEmbedding(data.subject, body);
  const embedding = await generateEmbedding(ai, textForEmbedding);

  const senderHash = await hashEmail(data.sender_email);

  const messageData: MessageInsert = {
    external_id: data.external_id,
    channel: "api",
    channel_source: data.channel_source || "unknown",
    politician_id: politician.id,
    sender_hash: senderHash,
    campaign_id: null as any,
    classification_confidence: 0,
    message_embedding: embedding,
    language: "auto",
    received_at: data.timestamp,
    duplicate_rank: 0,
    processing_status: "processed",
    reply_scheduled_at: null,
    sender_flag: data.sender_flag,
    is_reply: data.is_reply,
    stalwart_message_id: undefined,
    stalwart_account_id: undefined,
  };

  const messageId = await db.insertMessage(messageData);

  await db.storeMessageContact({
    messageId,
    senderHash,
    senderEmail: data.sender_email,
    senderName: data.sender_name,
    capturedAt: data.timestamp,
  });

  const classification = await db.classifyAndAssignToCluster(
    messageId,
    embedding,
    politician.id,
    data.campaign_hint,
  );

  let duplicateRank = 0;
  if (classification.campaign_id !== null) {
    duplicateRank = await db.getDuplicateRank(
      senderHash,
      politician.id,
      classification.campaign_id,
    );
    await db.updateMessageFields(messageId, {
      duplicate_rank: duplicateRank,
      classification_confidence: classification.confidence,
    });

    await db.upsertSupporter(
      classification.campaign_id,
      politician.id,
      senderHash,
      data.timestamp,
    );
  }

  const replySchedule =
    duplicateRank === 0 && classification.campaign_id !== null
      ? await applyReplyScheduleForMessage(db, messageId)
      : null;

  if (replySchedule?.send_immediately && immediateReplyHandler) {
    try {
      await immediateReplyHandler(messageId);
    } catch (_error) {
      console.error("Immediate reply send failed");
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
    reply_scheduled_at: replySchedule?.reply_scheduled_at ?? null,
    send_immediately: replySchedule?.send_immediately ?? false,
  };
}
