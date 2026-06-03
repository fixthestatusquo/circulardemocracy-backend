// Reply Worker - Background worker for sending scheduled auto-replies
// Runs periodically to process pending and scheduled reply emails

import type { DatabaseClient } from "./database";
import { resolveOutboundEmailIdentity } from "./email_impersonation";
import { renderEmailLayout } from "./email_layout";
import {
  type EmailMessage,
  JMAPClient,
  jmapWellKnownSessionUrl,
  resolveMailAccountIdFromSession,
} from "./jmap_client";
import {
  buildStalwartImpersonationLogin,
  emailHostedOnDomain,
  normalizeMailDomain,
  resolveJmapAdminCredentials,
  type StalwartImpersonationConfig,
} from "./stalwart_jmap";
import { getSupabaseRelayAccessToken } from "./supabase_relay_token";

export interface WorkerConfig {
  jmapApiUrl: string;
  jmapAccountId: string;
  jmapBearerToken: string;
  stalwartImpersonation?: StalwartImpersonationConfig;
}

/** Worker / runtime bindings used for outbound JMAP + Supabase relay auth. */
export type MailSendBindings = {
  JMAP_URL?: string;
  SUPABASE_URL?: string;
  SUPABASE_ANON_KEY?: string;
  /** Stalwart admin / Supabase user for outbound JMAP (impersonation or password-grant JWT). */
  JMAP_ADMIN_EMAIL?: string;
  JMAP_ADMIN_PASSWORD?: string;
  /**
   * When set (e.g. from `DEFAULT_DOMAIN` in `.env`), outbound mail uses Stalwart Basic-auth
   * impersonation (`fromAddress%JMAP_ADMIN_EMAIL`) instead of the Supabase relay Bearer.
   */
  DEFAULT_DOMAIN?: string;
};

function resolveStalwartJmapWorkerConfig(): WorkerConfig | null {
  const jmapApiUrl =
    jmapWellKnownSessionUrl(
      process.env as Record<string, string | undefined | null>,
    )?.trim() ?? "";
  if (!jmapApiUrl) {
    return null;
  }

  const defaultDomainRaw = (process.env.DEFAULT_DOMAIN || "").trim();
  if (defaultDomainRaw) {
    const admin = resolveJmapAdminCredentials(
      process.env as Record<string, string | undefined | null>,
    );
    if (!admin) {
      return null;
    }
    return {
      jmapApiUrl,
      jmapAccountId: "",
      jmapBearerToken: "",
      stalwartImpersonation: {
        defaultDomainLower: normalizeMailDomain(defaultDomainRaw),
        adminEmail: admin.adminEmail,
        adminPassword: admin.adminPassword,
      },
    };
  }

  return {
    jmapApiUrl,
    jmapAccountId: "",
    jmapBearerToken: "",
  };
}

export interface MessageToProcess {
  id: number;
  external_id: string;
  politician_id: number;
  campaign_id: number;
  sender_hash: string;
  reply_scheduled_at: string | null;
  received_at: string;
  reply_retry_count: number;
}

export interface ProcessingResult {
  total: number;
  sent: number;
  failed: number;
  errors: Array<{ message_id: number | string; error: string }>;
}

interface SendContext {
  supporterId: number | null;
}

/**
 * Main worker function to process and send scheduled replies.
 * Groups messages by politician to reuse JMAP authentication/connections.
 */
export async function sendScheduledReplies(
  db: DatabaseClient,
  filters: {
    politicianId?: number;
    campaignId?: number;
    limit?: number;
  } = {},
): Promise<ProcessingResult> {
  const result: ProcessingResult = {
    total: 0,
    sent: 0,
    failed: 0,
    errors: [],
  };

  try {
    // 1. Get messages ready to send with optional filters
    const messages = await getMessagesReadyToSend(db, filters);
    if (messages.length === 0) {
      return result;
    }

    // 2. Claim messages by setting status to 'sending' to prevent concurrency issues
    const messageIds = messages.map((m) => m.id);
    await db.bulkUpdateMessageStatus(messageIds, "sending");

    result.total = messages.length;
    console.log(
      `[Reply Worker] Claimed ${messages.length} messages for processing`,
    );

    // 3. Group messages by politician to reuse auth
    const byPolitician = new Map<number, MessageToProcess[]>();
    for (const msg of messages) {
      const list = byPolitician.get(msg.politician_id) ?? [];
      list.push(msg);
      byPolitician.set(msg.politician_id, list);
    }

    console.log(
      `[Reply Worker] Grouped into ${byPolitician.size} politician batch(es)`,
    );

    // 4. Process each politician batch
    for (const [politicianId, batch] of byPolitician.entries()) {
      const politicianResult = await sendPoliticianBatch(
        db,
        politicianId,
        batch,
      );

      result.sent += politicianResult.sent;
      result.failed += politicianResult.failed;
      result.errors.push(...politicianResult.errors);
    }

    console.log(
      `[Reply Worker] Completed: ${result.sent} sent, ${result.failed} failed`,
    );

    return result;
  } catch (error) {
    console.error("[Reply Worker] Fatal error in scheduled processing");
    throw error;
  }
}

/**
 * Processes all messages for a single politician.
 * Resolves JMAP configuration once and reuses it for the entire batch.
 */
async function sendPoliticianBatch(
  db: DatabaseClient,
  politicianId: number,
  messages: MessageToProcess[],
): Promise<ProcessingResult> {
  const result: ProcessingResult = {
    total: messages.length,
    sent: 0,
    failed: 0,
    errors: [],
  };

  try {
    const politician = await getPoliticianById(db, politicianId);
    if (!politician) {
      const errorMsg = `Politician ${politicianId} not found`;
      for (const msg of messages) {
        await handleSendFailure(db, msg, errorMsg);
        result.failed++;
        result.errors.push({ message_id: msg.id, error: errorMsg });
      }
      return result;
    }

    // Cache campaigns, templates, and JMAP clients to avoid redundant calls
    const campaignCache = new Map<number, any>();
    const templateCache = new Map<number, any>();
    const jmapClientCache = new Map<string, JMAPClient>();
    const jmapEmailCache = new Map<string, EmailMessage>();

    // Resolve JMAP config once for this politician
    const jmapResolve = await resolveSingleServiceAccountConfig();
    if (!jmapResolve.ok) {
      const errorMsg = jmapResolve.reason;
      for (const msg of messages) {
        await handleSendFailure(db, msg, errorMsg);
        result.failed++;
        result.errors.push({ message_id: msg.id, error: errorMsg });
      }
      return result;
    }

    // 1. Pre-fetch JMAP emails in bulk to avoid per-message lookups
    const imp = jmapResolve.config.stalwartImpersonation;
    const fetchClientKey = imp ? `imp:${politician.email}` : "relay:default";
    const jmapClientForFetch = createJMAPClient(
      jmapResolve.config,
      politician.email,
    );
    jmapClientCache.set(fetchClientKey, jmapClientForFetch);

    try {
      const externalIds = messages.map((m) => m.external_id);
      const emails = await jmapClientForFetch.getEmails(externalIds);
      for (const [id, email] of emails) {
        jmapEmailCache.set(id, email);
      }
    } catch (error) {
      console.error(
        `[Reply Worker] Bulk email fetch failed for politician ${politicianId}:`,
        error,
      );
    }

    // Process messages in parallel with a concurrency limit
    const CONCURRENCY = 10;
    for (let i = 0; i < messages.length; i += CONCURRENCY) {
      const chunk = messages.slice(i, i + CONCURRENCY);
      const tasks = chunk.map(async (message) => {
        try {
          const jmapEmail = jmapEmailCache.get(message.external_id);
          if (!jmapEmail) {
            throw new Error(`JMAP email not found for ${message.external_id}`);
          }

          let template = templateCache.get(message.campaign_id);
          if (!template) {
            template = await db.getActiveTemplateForCampaign(
              message.campaign_id,
              politician.id,
            );
            if (!template) {
              throw new Error(
                `No active template for campaign ${message.campaign_id}`,
              );
            }
            templateCache.set(message.campaign_id, template);
          }

          let campaign = campaignCache.get(message.campaign_id);
          if (!campaign) {
            campaign = await getCampaignById(db, message.campaign_id);
            if (!campaign) {
              throw new Error(`Campaign ${message.campaign_id} not found`);
            }
            campaignCache.set(message.campaign_id, campaign);
          }

          const imp = jmapResolve.config.stalwartImpersonation;
          const outboundIdentity = resolveOutboundEmailIdentity(
            {
              id: politician.id,
              name: politician.name,
              email: politician.email,
              reply_to: politician.reply_to,
            },
            {
              technical_email: campaign.technical_email ?? politician.email,
              reply_to_email:
                campaign.reply_to_email ??
                politician.reply_to ??
                politician.email,
            },
          );
          if (!outboundIdentity) {
            throw new Error(
              `No From/Reply-To for campaign ${message.campaign_id}`,
            );
          }
          const clientKey = imp
            ? `imp:${outboundIdentity.fromEmail}`
            : "relay:default";
          let jmapClient = jmapClientCache.get(clientKey);
          if (!jmapClient) {
            jmapClient = createJMAPClient(
              jmapResolve.config,
              outboundIdentity.fromEmail,
            );
            jmapClientCache.set(clientKey, jmapClient);
          }

          await sendReply(db, message, {
            politician,
            jmapConfig: jmapResolve.config,
            template,
            campaign,
            jmapEmail,
            jmapClient,
          });
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
      });
      await Promise.all(tasks);
    }

    return result;
  } catch (error) {
    console.error(
      `[Reply Worker] Fatal error processing batch for politician ${politicianId}`,
    );
    throw error;
  }
}

export async function replyMessage(
  db: DatabaseClient,
  messageId: string,
  politicianId: number,
): Promise<ProcessingResult> {
  const result: ProcessingResult = {
    total: 1,
    sent: 0,
    failed: 0,
    errors: [],
  };

  let internalId: number | string = messageId;
  try {
    const message = await db.getMessageByExternalId(
      messageId,
      "stalwart",
      politicianId,
    );
    if (!message) {
      throw new Error(
        `Message ${messageId} not found for politician ${politicianId}`,
      );
    }
    internalId = message.id;

    const politician = await getPoliticianById(db, politicianId);
    if (!politician) {
      throw new Error(`Politician ${politicianId} not found`);
    }

    // Still resolve auth per immediate call (CLI/Web-hook context)
    const jmapResolve = await resolveSingleServiceAccountConfig();
    if (!jmapResolve.ok) {
      throw new Error(jmapResolve.reason);
    }

    const server = createJMAPClient(jmapResolve.config, politician.email);

    const emails = await server.getEmails([message.external_id]);
    const jmapEmail = emails.get(message.external_id);
    if (!jmapEmail) {
      throw new Error(
        `Original message ${message.external_id} not found on JMAP server`,
      );
    }
    const messageToProcess: MessageToProcess = {
      id: message.id,
      external_id: message.external_id,
      politician_id: message.politician_id,
      campaign_id: message.campaign_id,
      sender_hash: message.sender_hash,
      reply_scheduled_at: message.reply_scheduled_at || null,
      received_at: message.received_at,
      reply_retry_count: (message as any).reply_retry_count ?? 0,
    };

    const template = await db.getActiveTemplateForCampaign(
      message.campaign_id,
      politician.id,
    );
    if (!template) {
      throw new Error(`No active template for campaign ${message.campaign_id}`);
    }

    const campaign = await getCampaignById(db, message.campaign_id);
    if (!campaign) {
      throw new Error(`Campaign ${message.campaign_id} not found`);
    }

    await sendReply(db, messageToProcess, {
      politician,
      jmapConfig: jmapResolve.config,
      template,
      campaign,
      jmapEmail,
      jmapClient: server,
    });

    result.sent = 1;
    return result;
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : "Unknown error";
    result.failed = 1;
    result.errors.push({ message_id: internalId, error: errorMsg });
    return result;
  }
}

// Maximum number of retry attempts before giving up
const MAX_RETRY_ATTEMPTS = 10;
const RETRY_DELAYS_MINUTES = [5, 15, 60];

/**
 * Gets messages that are ready to send
 */
async function getMessagesReadyToSend(
  db: DatabaseClient,
  filters: {
    politicianId?: number;
    campaignId?: number;
    limit?: number;
  } = {},
): Promise<MessageToProcess[]> {
  try {
    const data = await db.getMessagesReadyToSend(MAX_RETRY_ATTEMPTS, filters);

    return (data || []).map((msg) => ({
      ...msg,
      reply_retry_count: msg.reply_retry_count ?? 0,
    }));
  } catch (error) {
    console.error("Error fetching messages to send");
    throw error;
  }
}

/**
 * Processes a single message using pre-resolved context.
 */
async function sendReply(
  db: DatabaseClient,
  message: MessageToProcess,
  params: {
    politician: {
      id: number;
      email: string;
      name: string;
      position: string;
      party: string;
      reply_to: string | null;
    };
    jmapConfig: WorkerConfig;
    template: {
      subject: string;
      id: number;
      body: string;
      layout_type: string;
      campaign_name?: string;
    };
    campaign: {
      id: number;
      name: string;
      technical_email?: string | null;
      reply_to_email?: string | null;
    };
    jmapEmail: EmailMessage;
    jmapClient: JMAPClient;
  },
): Promise<void> {
  const { politician, jmapConfig, template, campaign, jmapEmail, jmapClient } =
    params;
  const {
    subject: templateSubject,
    body: templateBody,
    layout_type,
  } = template;

  // 1. Resolve recipient email
  const senderEmail = jmapEmail.replyTo || jmapEmail.from;
  if (!senderEmail) {
    const errorMsg = `sender not found for message ${message.id} (JMAP ID ${message.external_id})`;
    await handleSendFailure(db, message, errorMsg);
    throw new Error(errorMsg);
  }

  // 2. Resolve outbound identity
  const outboundIdentity = resolveOutboundEmailIdentity(
    {
      id: politician.id,
      name: politician.name,
      email: politician.email,
      reply_to: politician.reply_to,
    },
    {
      technical_email: politician.email,
      reply_to_email: politician.reply_to || politician.email,
    },
  );

  if (!outboundIdentity) {
    const errorMsg = `No From/Reply-To: set campaigns.technical_email and/or politicians.email for campaign ${message.campaign_id}`;
    await handleSendFailure(db, message, errorMsg);
    throw new Error(errorMsg);
  }

  const imp = jmapConfig.stalwartImpersonation;
  if (imp) {
    if (!emailHostedOnDomain(outboundIdentity.fromEmail, imp.defaultDomainLower)) {
      const errorMsg = `DEFAULT_DOMAIN is ${imp.defaultDomainLower} but outbound From is not on that domain`;
      await handleSendFailure(db, message, errorMsg);
      throw new Error(errorMsg);
    }
  }

  // 3. Resolve template tokens
  const tokens = {
    subject: jmapEmail.subject || "",
    sender: jmapEmail.fromName || jmapEmail.from || "",
    date: jmapEmail.receivedAt
      ? new Date(jmapEmail.receivedAt).toLocaleDateString()
      : "",
  };

  const personalizedSubject = replaceTokens(templateSubject, tokens);
  const personalizedBody = replaceTokens(templateBody, tokens);

  // 4. Render and build email
  const emailContent = renderEmailLayout({
    subject: personalizedSubject,
    markdown_body: personalizedBody,
    layout_type: layout_type as any,
    campaign_name: campaign.name,
    politician_name: politician.name,
    politician_email: politician.email,
    politician_party: politician.party,
    politician_position: politician.position,
  });

  const email: EmailMessage = {
    from: outboundIdentity.fromEmail,
    fromName: outboundIdentity.fromDisplayName,
    to: [senderEmail],
    replyTo: outboundIdentity.replyToEmail,
    subject: emailContent.subject,
    textBody: emailContent.textBody,
    htmlBody: emailContent.htmlBody,
  };

  // Add threading headers if we have the original message-id
  if (jmapEmail.messageId) {
    email.inReplyTo = jmapEmail.messageId;
    email.references = jmapEmail.messageId;
  }

  // 9. Send via JMAP
  const sendResult = await jmapClient.sendEmail(email);

  if (!sendResult.success) {
    console.log(sendResult);
    const errorMsg = "JMAP send failed";
    console.error(
      `[Reply Worker] ✗ Failed to send reply for message ${message.id}: ${errorMsg}`,
    );
    await handleSendFailure(db, message, errorMsg);
    throw new Error(errorMsg);
  }

  // 10. Log success and finalize
  console.log(
    `[Reply Worker] ✓ Sent reply for message ${message.id} (sent ID: ${sendResult.messageId})`,
  );

  await db.markMessageReplyDelivered(message.id, {
    reply_id: sendResult.messageId,
    reply_template_id: template.id,
  });
}

/**
 * Replaces tokens in the form of {name} with values from the provided map.
 */
export function replaceTokens(
  text: string,
  tokens: Record<string, string>,
): string {
  let result = text;
  for (const [key, value] of Object.entries(tokens)) {
    const regex = new RegExp(`\\{${key}\\}`, "g");
    result = result.replace(regex, value);
  }
  return result;
}

/**
 * Handles send failure by updating retry count or marking as permanently failed.
 * Also resets status from 'sending' back to 'unanswered' (if retrying) or 'failed'.
 */
async function handleSendFailure(
  db: DatabaseClient,
  message: MessageToProcess,
  errorMsg: string,
): Promise<void> {
  const safeError = sanitizeErrorMessage(errorMsg);
  const newRetryCount = message.reply_retry_count + 1;

  if (newRetryCount >= MAX_RETRY_ATTEMPTS) {
    // Exceeded max retries - mark as permanently failed
    await db.markMessageAsFailed(message.id, safeError);
    // Explicitly update processing_status to 'failed' (markMessageAsFailed only sets the reason)
    await db.updateMessageFields(message.id, {
      processing_status: "failed",
    });

    console.error(
      `[Reply Worker] Message ${message.id} permanently failed after ${MAX_RETRY_ATTEMPTS} attempts`,
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
      safeError,
      nextRetryAt,
    );
    // Reset status to 'unanswered' so it can be picked up by the next worker run
    await db.updateMessageFields(message.id, {
      processing_status: "unanswered",
    });

    console.warn(
      `[Reply Worker] Message ${message.id} failed (attempt ${newRetryCount}/${MAX_RETRY_ATTEMPTS}), scheduled retry at ${nextRetryAt}`,
    );
  }
}

async function buildSendContext(
  db: DatabaseClient,
  message: MessageToProcess,
  _identity: {
    fromEmail: string;
    replyToEmail: string;
    fromDisplayName: string;
  },
): Promise<SendContext> {
  const supporterId = await db.upsertSupporter(
    message.campaign_id,
    message.politician_id,
    message.sender_hash,
    message.received_at,
  );
  return {
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
    console.error("Error fetching campaign");
    return null;
  }
}

/**
 * Gets politician by ID
 */
async function getPoliticianById(
  db: DatabaseClient,
  politicianId: number,
): Promise<{
  id: number;
  email: string;
  name: string;
  position: string;
  party: string;
  reply_to: string | null;
} | null> {
  try {
    return await db.getPoliticianById(politicianId);
  } catch (error) {
    console.error("Error fetching politician");
    return null;
  }
}

type JmapResolveResult =
  | { ok: true; config: WorkerConfig }
  | { ok: false; reason: string };

async function resolveSingleServiceAccountConfig(): Promise<JmapResolveResult> {
  const baseConfig = resolveStalwartJmapWorkerConfig();
  if (!baseConfig) {
    const defaultDomainHint = (process.env.DEFAULT_DOMAIN || "").trim()
      ? " For DEFAULT_DOMAIN mode, set JMAP_URL plus JMAP_ADMIN_EMAIL and JMAP_ADMIN_PASSWORD."
      : "";
    return {
      ok: false,
      reason:
        "Single JMAP relay service account is not configured. Set JMAP_URL (base mail server URL)." +
        defaultDomainHint,
    };
  }

  if (baseConfig.stalwartImpersonation) {
    return {
      ok: true,
      config: baseConfig,
    };
  }

  const relayToken = await getSupabaseRelayAccessToken();
  if (!relayToken) {
    return {
      ok: false,
      reason:
        "Supabase IdP relay auth is required. Set SUPABASE_URL, SUPABASE_ANON_KEY, JMAP_ADMIN_EMAIL, and JMAP_ADMIN_PASSWORD.",
    };
  }

  const config: WorkerConfig = {
    ...baseConfig,
    jmapAccountId: await fetchAndResolveMailAccountIdFromSession(
      baseConfig.jmapApiUrl,
      relayToken,
    ),
    jmapBearerToken: relayToken,
  };

  return {
    ok: true,
    config,
  };
}

async function fetchAndResolveMailAccountIdFromSession(
  sessionUrl: string,
  bearerToken: string,
): Promise<string> {
  const response = await fetch(sessionUrl, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${bearerToken}`,
      Accept: "application/json",
    },
  });
  if (!response.ok) {
    throw new Error(`JMAP session GET failed (${response.status})`);
  }
  const session = (await response.json()) as {
    primaryAccounts?: Record<string, string>;
    accounts?: Record<string, unknown>;
  };
  return resolveMailAccountIdFromSession(session);
}

function sanitizeErrorMessage(raw: string): string {
  return raw
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[redacted-email]")
    .slice(0, 500);
}

/**
 * Creates a JMAPClient based on configuration and target email (for impersonation).
 */
export function createJMAPClient(
  config: WorkerConfig,
  targetEmail: string,
): JMAPClient {
  const imp = config.stalwartImpersonation;
  if (imp) {
    return new JMAPClient({
      apiUrl: config.jmapApiUrl,
      accountId: "",
      basicUsername: buildStalwartImpersonationLogin(
        imp.adminEmail,
        targetEmail,
      ),
      basicPassword: imp.adminPassword,
    });
  }

  return new JMAPClient({
    apiUrl: config.jmapApiUrl,
    accountId: config.jmapAccountId,
    bearerToken: config.jmapBearerToken,
  });
}
