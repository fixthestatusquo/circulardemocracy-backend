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
  status: "unanswered" | "failed" | "politician_not_found" | "duplicate";
  message_id?: number;
  campaign_id?: number;
  campaign_slug?: string;
  confidence?: number;
  duplicate_rank?: number;
  reply_scheduled_at?: string | null;
  send_immediately?: boolean;
  errors?: string[];
}

/**
 * Applies send timing from the campaign's active template when the message is eligible:
 * campaign assigned, duplicate_rank 0, not yet sent. Returns null when no auto-reply applies.
 *
 * What the heck is going on here
 */
export async function applyReplyScheduleForMessage(
  db: DatabaseClient,
  messageId: number,
): Promise<ScheduleResult | null> {
  const row = await db.getMessageForReplyScheduling(messageId);
  if (
    !row ||
    row.reply_sent_at ||
    row.processing_status === "replied" ||
    row.processing_status === "followup"
  ) {
    return null;
  }
  if (row.campaign_id == null || row.duplicate_rank !== 0) {
    return null;
  }

  const activeTemplate = await db.getActiveTemplateForCampaign(
    row.campaign_id,
    row.politician_id,
  );
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
): Promise<MessageProcessingResult> {
  const politician = await db.findPoliticianByEmail(data.recipient_email);
  if (!politician) {
    throw new PoliticianNotFoundError(data.recipient_email);
  }

  const existingMessage = await db.getMessageByExternalId(
    data.external_id,
    data.channel_source || "unknown",
    politician.id,
  );

  if (existingMessage) {
    console.log("existing message", existingMessage);
    process.exit(1);
    let campaignName = "Unknown";
    let campaignId = existingMessage.campaign_id;

    if (existingMessage.campaigns) {
      const camp = Array.isArray(existingMessage.campaigns)
        ? existingMessage.campaigns[0]
        : existingMessage.campaigns;
      if (camp) {
        campaignName = camp.slug;
        campaignId = camp.id;
      }
    }

    return {
      success: false,
      status: "duplicate",
      message_id: existingMessage.id,
      campaign_id: campaignId ?? undefined,
      campaign_slug: campaignName ?? undefined,
      duplicate_rank: existingMessage.duplicate_rank,
      errors: [`Message with external_id ${data.external_id} already exists`],
    };
  }

  const body = data.text_content || data.message;
  const textForEmbedding = formatEmailContentForEmbedding(data.subject, body);
  const embedding = await generateEmbedding(ai, textForEmbedding);

  const senderHash = await hashEmail(data.sender_email);

  const isReply =
    data.is_reply === true || /^(re:|fwd:|fw:)/i.test(data.subject.trim());

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
    processing_status: isReply ? "followup" : "unanswered",
    // reply_scheduled_at omitted — defaults to null in the DB
    sender_flag: data.sender_flag,
  };

  const messageId = await db.insertMessage(messageData);

  const classification = await db.classifyAndAssignToCluster(
    messageId,
    embedding,
    politician.id,
    data.campaign_hint,
  );
  console.log("new", classification);
  process.exit(1);
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

  return {
    success: true,
    message_id: messageId,
    status: "unanswered",
    campaign_id: classification.campaign_id ?? undefined,
    campaign_slug: classification.campaign_slug ?? undefined,
    confidence: classification.confidence,
    duplicate_rank: duplicateRank,
    reply_scheduled_at: replySchedule?.reply_scheduled_at ?? null,
    send_immediately: replySchedule?.send_immediately ?? false,
  };
}

/**
 * Batch-process multiple messages for the same politician.
 *
 * This collapses ~18N DB calls down to ~6 + N (where N is the batch size):
 *   - 1 politician lookup (shared)
 *   - N embeddings + N hashes (compute, not DB)
 *   - N individual message INSERTs (Supabase lacks bulk insert returning ids)
 *   - 1 batch classification (hints + vector search calls batched)
 *   - 1 batch cluster assignment (single lock window)
 *   - 1 batch duplicate rank query
 *   - 1 batch supporter upsert
 *   - N individual reply scheduling (with template cache)
 *
 * The caller is responsible for pre-filtering duplicates
 * (e.g. via getAlreadyProcessedExternalIds).
 */
export async function processMessageBatch(
  db: DatabaseClient,
  ai: Ai,
  messages: MessageInput[],
): Promise<MessageProcessingResult[]> {
  if (messages.length === 0) return [];

  // Step 0: All messages must target the same politician
  const firstRecipient = messages[0].recipient_email;
  const politician = await db.findPoliticianByEmail(firstRecipient);
  if (!politician) {
    throw new PoliticianNotFoundError(firstRecipient);
  }
  // Verify all messages share the same politician
  for (let i = 1; i < messages.length; i++) {
    if (messages[i].recipient_email !== firstRecipient) {
      throw new Error(
        `Batch contains messages for different recipients: ${firstRecipient} vs ${messages[i].recipient_email}`,
      );
    }
  }

  const politicianId = politician.id;
  const n = messages.length;

  // Step 1: Generate embeddings and hashes for all messages
  const embeddings: number[][] = [];
  const senderHashes: string[] = [];

  for (const msg of messages) {
    const body = msg.text_content || msg.message;
    const textForEmbedding = formatEmailContentForEmbedding(msg.subject, body);
    embeddings.push(await generateEmbedding(ai, textForEmbedding));
    senderHashes.push(await hashEmail(msg.sender_email));
  }

  // Step 2: Bulk-insert all messages
  const messageIds: number[] = [];
  const messageDataList: MessageInsert[] = [];

  for (let i = 0; i < n; i++) {
    const msg = messages[i];
    const isReply =
      msg.is_reply === true || /^(re:|fwd:|fw:)/i.test(msg.subject.trim());

    const messageData: MessageInsert = {
      external_id: msg.external_id,
      channel: "api",
      channel_source: msg.channel_source || "unknown",
      politician_id: politicianId,
      sender_hash: senderHashes[i],
      campaign_id: null as unknown as number,
      classification_confidence: 0,
      message_embedding: embeddings[i],
      language: "auto",
      received_at: msg.timestamp,
      duplicate_rank: 0,
      processing_status: isReply ? "followup" : "unanswered",
      // reply_scheduled_at omitted — defaults to null in the DB
      sender_flag: msg.sender_flag,
    };
    messageDataList.push(messageData);

    const id = await db.insertMessage(messageData);
    messageIds.push(id);
  }

  // Step 3: Batch classify all messages
  const classificationEntries = messages.map((msg, i) => ({
    embedding: embeddings[i],
    politicianId,
    campaignHint: msg.campaign_hint,
  }));
  const classifications = await (db as any).batchClassifyMessages(classificationEntries);

  // Step 4: Update messages with campaign assignments
  const classificationUpdates = classifications.map((c: any, i: number) => ({
    messageId: messageIds[i],
    fields: {
      campaign_id: c.campaign_id,
      classification_confidence: c.confidence,
    },
  }));
  await (db as any).batchUpdateMessageFields(classificationUpdates);

  // Step 5: Batch cluster assignment (single lock window)
  const unassignedIndices: number[] = [];
  const unassignedMessageIds: number[] = [];
  const unassignedEmbeddings: number[][] = [];

  for (let i = 0; i < n; i++) {
    if (classifications[i].campaign_id === null) {
      unassignedIndices.push(i);
      unassignedMessageIds.push(messageIds[i]);
      unassignedEmbeddings.push(embeddings[i]);
    }
  }

  if (unassignedMessageIds.length > 0) {
    await (db as any).batchAssignToClusters(
      unassignedMessageIds,
      unassignedEmbeddings,
      politicianId,
    );
  }

  // Step 6: Batch compute duplicate ranks
  const rankEntries: Array<{ senderHash: string; politicianId: number; campaignId: number }> = [];
  for (let i = 0; i < n; i++) {
    if (classifications[i].campaign_id !== null) {
      rankEntries.push({
        senderHash: senderHashes[i],
        politicianId,
        campaignId: classifications[i].campaign_id!,
      });
    }
  }

  const rankMap = await (db as any).batchGetDuplicateRanks(rankEntries);

  // Step 7: Compute duplicate ranks and prepare supporter entries
  const duplicateRanks: number[] = new Array(n).fill(0);
  const rankUpdates: Array<{ messageId: number; fields: Record<string, unknown> }> = [];
  const supporterEntries: Array<{
    campaignId: number;
    politicianId: number;
    senderHash: string;
    firstMessageAt: string;
  }> = [];

  for (let i = 0; i < n; i++) {
    const c = classifications[i];
    if (c.campaign_id !== null) {
      const key = `${senderHashes[i]}:${politicianId}:${c.campaign_id}`;
      const rank = rankMap.get(key) || 0;
      duplicateRanks[i] = rank;

      rankUpdates.push({
        messageId: messageIds[i],
        fields: { duplicate_rank: rank },
      });

      supporterEntries.push({
        campaignId: c.campaign_id,
        politicianId,
        senderHash: senderHashes[i],
        firstMessageAt: messages[i].timestamp,
      });
    }
  }

  // Step 8: Apply rank updates and upsert supporters in batch
  if (rankUpdates.length > 0) {
    await (db as any).batchUpdateMessageFields(rankUpdates);
  }
  if (supporterEntries.length > 0) {
    await (db as any).batchUpsertSupporters(supporterEntries);
  }

  // Step 9: Apply reply scheduling (with cached templates)
  const templateCache = new Map<string, any>();

  const results: MessageProcessingResult[] = [];
  for (let i = 0; i < n; i++) {
    const c = classifications[i];
    const rank = duplicateRanks[i];
    let replySchedule: ScheduleResult | null = null;

    if (rank === 0 && c.campaign_id !== null) {
      const cacheKey = `${c.campaign_id}:${politicianId}`;
      let activeTemplate = templateCache.get(cacheKey);
      if (activeTemplate === undefined) {
        activeTemplate = await db.getActiveTemplateForCampaign(
          c.campaign_id,
          politicianId,
        );
        templateCache.set(cacheKey, activeTemplate);
      }

      if (activeTemplate) {
        const row = await db.getMessageForReplyScheduling(messageIds[i]);
        if (
          row &&
          !row.reply_sent_at &&
          row.processing_status !== "replied" &&
          row.processing_status !== "followup"
        ) {
          if (row.reply_scheduled_at && !isReadyToSend(row.reply_scheduled_at)) {
            replySchedule = {
              reply_scheduled_at: row.reply_scheduled_at,
              send_immediately: false,
            };
          } else {
            replySchedule = calculateReplySchedule(
              activeTemplate.send_timing as "immediate" | "office_hours" | "scheduled",
              activeTemplate.scheduled_for,
              row.received_at,
            );
            await db.updateMessageFields(messageIds[i], {
              reply_scheduled_at: replySchedule.reply_scheduled_at,
            });
          }
        }
      }
    }

    results.push({
      success: true,
      message_id: messageIds[i],
      status: "unanswered",
      campaign_id: c.campaign_id ?? undefined,
      campaign_slug: c.campaign_slug ?? undefined,
      confidence: c.confidence,
      duplicate_rank: rank,
      reply_scheduled_at: replySchedule?.reply_scheduled_at ?? null,
      send_immediately: replySchedule?.send_immediately ?? false,
    });
  }

  return results;
}
