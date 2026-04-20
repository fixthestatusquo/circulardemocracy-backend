// Reply Worker - Background worker for sending scheduled auto-replies
// Runs periodically to process pending and scheduled reply emails

import type { DatabaseClient } from "./database";
import { renderEmailLayout } from "./email_layout";
import { type EmailMessage, JMAPClient } from "./jmap_client";

export interface WorkerConfig {
  jmapApiUrl: string;
  jmapAccountId: string;
  jmapUsername: string;
  jmapPassword: string;
}

export interface MessageToProcess {
  id: number;
  external_id: string;
  politician_id: number;
  campaign_id: number;
  sender_hash: string;
  reply_status: "pending" | "scheduled";
  reply_scheduled_at: string | null;
  received_at: string;
  reply_retry_count: number;
}

export interface ProcessingResult {
  total: number;
  sent: number;
  failed: number;
  errors: Array<{ message_id: number; error: string }>;
}

interface SendContext {
  senderAddress: string;
  supporterId: number | null;
}

/**
 * Main worker function to process and send scheduled replies
 */
export async function processScheduledReplies(
  db: DatabaseClient,
  config: WorkerConfig,
): Promise<ProcessingResult> {
  const result: ProcessingResult = {
    total: 0,
    sent: 0,
    failed: 0,
    errors: [],
  };

  try {
    // 1. Get messages ready to send
    const messages = await getMessagesReadyToSend(db);
    result.total = messages.length;

    console.log(`[Reply Worker] Found ${messages.length} messages to process`);

    if (messages.length === 0) {
      return result;
    }

    // 2. Initialize JMAP client
    const jmapClient = new JMAPClient({
      apiUrl: config.jmapApiUrl,
      accountId: config.jmapAccountId,
      username: config.jmapUsername,
      password: config.jmapPassword,
    });

    // 3. Process each message
    for (const message of messages) {
      try {
        await processSingleMessage(db, jmapClient, message);
        result.sent++;
        console.log(`[Reply Worker] ✓ Sent reply for message ${message.id}`);
      } catch (error) {
        result.failed++;
        const errorMsg =
          error instanceof Error ? error.message : "Unknown error";
        result.errors.push({
          message_id: message.id,
          error: errorMsg,
        });
        console.error(
          `[Reply Worker] ✗ Failed to send reply for message ${message.id}:`,
          errorMsg,
        );
      }
    }

    console.log(
      `[Reply Worker] Completed: ${result.sent} sent, ${result.failed} failed`,
    );

    return result;
  } catch (error) {
    console.error("[Reply Worker] Fatal error:", error);
    throw error;
  }
}

export async function processReplyImmediately(
  db: DatabaseClient,
  config: WorkerConfig,
  messageId: number,
): Promise<void> {
  const message = await getMessageById(db, messageId);
  if (!message) {
    throw new Error(`Message ${messageId} not eligible for immediate reply`);
  }

  const jmapClient = new JMAPClient({
    apiUrl: config.jmapApiUrl,
    accountId: config.jmapAccountId,
    username: config.jmapUsername,
    password: config.jmapPassword,
  });

  await processSingleMessage(db, jmapClient, message);
}

// Maximum number of retry attempts before giving up
const MAX_RETRY_ATTEMPTS = 3;
const RETRY_DELAYS_MINUTES = [5, 15, 60];

/**
 * Gets messages that are ready to send
 */
async function getMessagesReadyToSend(
  db: DatabaseClient,
): Promise<MessageToProcess[]> {
  try {
    // Query messages where:
    // - reply_status is 'pending' OR 'scheduled'
    // - reply_scheduled_at is NULL (immediate) OR <= NOW (scheduled time reached)
    // - reply_sent_at is NULL (not already sent)
    // - reply_retry_count < MAX_RETRY_ATTEMPTS (haven't exceeded retry limit)
    const data = await db.getMessagesReadyToSend(MAX_RETRY_ATTEMPTS);

    // Ensure reply_retry_count has a default value of 0
    const messages = (data || []).map((msg) => ({
      ...msg,
      reply_retry_count: msg.reply_retry_count ?? 0,
    }));

    return messages;
  } catch (error) {
    console.error("Error fetching messages to send:", error);
    throw error;
  }
}

async function getMessageById(
  db: DatabaseClient,
  messageId: number,
): Promise<MessageToProcess | null> {
  try {
    const record = await db.getMessageReadyToSendById(messageId);

    if (!record) {
      return null;
    }

    return {
      ...record,
      reply_retry_count: record.reply_retry_count ?? 0,
    };
  } catch (error) {
    console.error("Error fetching message by ID:", error);
    return null;
  }
}

/**
 * Processes a single message: loads template, renders email, sends via JMAP
 */
async function processSingleMessage(
  db: DatabaseClient,
  jmapClient: JMAPClient,
  message: MessageToProcess,
): Promise<void> {
  // 1. Get the active reply template for this campaign
  const template = await db.getActiveTemplateForCampaign(message.campaign_id);

  if (!template) {
    const errorMsg = `No active template found for campaign ${message.campaign_id}`;
    await handleSendFailure(db, message, errorMsg);
    throw new Error(errorMsg);
  }

  // 2. Get politician details for sender/reply-to
  const politician = await getPoliticianById(db, message.politician_id);
  if (!politician) {
    const errorMsg = `Politician ${message.politician_id} not found`;
    await handleSendFailure(db, message, errorMsg);
    throw new Error(errorMsg);
  }

  // 3. Get original sender email from sender_emails table
  const senderEmail = await db.getSenderEmailByMessageId(message.id);
  if (!senderEmail) {
    const errorMsg = `Sender email not found for message ${message.id}`;
    await handleSendFailure(db, message, errorMsg);
    throw new Error(errorMsg);
  }

  // 4. Get campaign details for header and sender address
  const campaign = await getCampaignById(db, message.campaign_id);
  if (!campaign?.technical_email) {
    const errorMsg = `Campaign technical email missing for campaign ${message.campaign_id}`;
    await handleSendFailure(db, message, errorMsg);
    throw new Error(errorMsg);
  }
  const sendContext = await buildSendContext(
    db,
    message,
    senderEmail,
    campaign.technical_email,
  );

  // 5. Render email content based on layout type
  const emailContent = renderEmailLayout({
    subject: template.subject,
    markdown_body: template.body,
    layout_type: template.layout_type,
    campaign_name: campaign?.name,
    politician_name: politician.name,
    politician_email: politician.email,
  });

  // 6. Build email message
  const email: EmailMessage = {
    from: sendContext.senderAddress,
    to: [senderEmail],
    replyTo: campaign.reply_to_email || politician.email,
    subject: emailContent.subject,
    textBody: emailContent.textBody,
    htmlBody: emailContent.htmlBody,
  };

  // 7. Send via JMAP
  const sendResult = await jmapClient.sendEmail(email);

  if (!sendResult.success) {
    const errorMsg = `JMAP send failed: ${sendResult.error}`;
    await db.logEmailEvent({
      message_id: message.id,
      campaign_id: message.campaign_id,
      politician_id: message.politician_id,
      supporter_id: sendContext.supporterId,
      sender_email: sendContext.senderAddress,
      recipient_email: senderEmail,
      subject: emailContent.subject,
      status: "failed",
      provider: "jmap",
      error_message: errorMsg,
    });
    await handleSendFailure(db, message, errorMsg);
    throw new Error(errorMsg);
  }

  await db.logEmailEvent({
    message_id: message.id,
    campaign_id: message.campaign_id,
    politician_id: message.politician_id,
    supporter_id: sendContext.supporterId,
    sender_email: sendContext.senderAddress,
    recipient_email: senderEmail,
    subject: emailContent.subject,
    status: "sent",
    provider: "jmap",
    provider_message_id: sendResult.messageId,
  });

  // 8. Update message status
  await markMessageAsSent(db, message.id);
}

/**
 * Handles send failure by updating retry count or marking as permanently failed
 */
async function handleSendFailure(
  db: DatabaseClient,
  message: MessageToProcess,
  errorMsg: string,
): Promise<void> {
  const newRetryCount = message.reply_retry_count + 1;

  if (newRetryCount >= MAX_RETRY_ATTEMPTS) {
    // Exceeded max retries - mark as permanently failed
    await db.markMessageAsFailed(message.id, errorMsg);
    console.error(
      `[Reply Worker] Message ${message.id} permanently failed after ${MAX_RETRY_ATTEMPTS} attempts: ${errorMsg}`,
    );
  } else {
    // Increment retry count and schedule a delayed re-mail attempt
    const retryDelayMinutes = RETRY_DELAYS_MINUTES[newRetryCount - 1] || 60;
    const nextRetryAt = new Date(
      Date.now() + retryDelayMinutes * 60 * 1000,
    ).toISOString();

    await db.updateMessageRetryCount(
      message.id,
      newRetryCount,
      errorMsg,
      nextRetryAt,
    );
    console.warn(
      `[Reply Worker] Message ${message.id} failed (attempt ${newRetryCount}/${MAX_RETRY_ATTEMPTS}), scheduled retry at ${nextRetryAt}: ${errorMsg}`,
    );
  }
}

async function buildSendContext(
  db: DatabaseClient,
  message: MessageToProcess,
  senderEmail: string,
  campaignTechnicalEmail: string,
): Promise<SendContext> {
  const senderAddress = campaignTechnicalEmail;
  const supporterId = await db.upsertSupporter(
    message.campaign_id,
    message.politician_id,
    message.sender_hash,
    senderEmail,
  );
  return {
    senderAddress,
    supporterId,
  };
}

/**
 * Gets campaign by ID
 */
async function getCampaignById(
  db: DatabaseClient,
  campaignId: number,
): Promise<{
  id: number;
  name: string;
  technical_email: string | null;
  reply_to_email: string | null;
} | null> {
  try {
    return await db.getCampaignById(campaignId);
  } catch (error) {
    console.error("Error fetching campaign:", error);
    return null;
  }
}

/**
 * Gets politician by ID
 */
async function getPoliticianById(
  db: DatabaseClient,
  politicianId: number,
): Promise<{ id: number; email: string; name: string } | null> {
  try {
    return await db.getPoliticianById(politicianId);
  } catch (error) {
    console.error("Error fetching politician:", error);
    return null;
  }
}

/**
 * Marks a message as sent
 */
async function markMessageAsSent(
  db: DatabaseClient,
  messageId: number,
): Promise<void> {
  try {
    await db.markMessageAsSent(messageId);
  } catch (error) {
    console.error("Error marking message as sent:", error);
    throw error;
  }
}
