// Reply Worker - Background worker for sending scheduled auto-replies
// Runs periodically to process pending and scheduled reply emails

import type { DatabaseClient } from "./database";
import { resolveOutboundEmailIdentity } from "./email_impersonation";
import { applyReplyScheduleForMessage } from "./message_processor";
import { isReadyToSend } from "./scheduling";
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
  resolveRelayImpersonationCredentials,
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
  /** Supabase user (email) used for password-grant relay tokens to call JMAP as the service identity. */
  RELAY_SERVICE_ACCOUNT_EMAIL?: string;
  RELAY_SERVICE_ACCOUNT_PASSWORD?: string;
  /**
   * When set (e.g. from `ALL_DOMAIN` in `.env`), outbound mail uses Stalwart Basic-auth
   * impersonation (`fromAddress%RELAY_SERVICE_ACCOUNT_EMAIL`) instead of the Supabase relay Bearer.
   */
  ALL_DOMAIN?: string;
};

function resolveStalwartJmapWorkerConfig(
  env: MailSendBindings,
): WorkerConfig | null {
  const jmapApiUrl =
    jmapWellKnownSessionUrl(
      env as Record<string, string | undefined | null>,
    )?.trim() ?? "";
  if (!jmapApiUrl) {
    return null;
  }

  const allDomainRaw = (env.ALL_DOMAIN || "").trim();
  if (allDomainRaw) {
    const relay = resolveRelayImpersonationCredentials(
      env as Record<string, string | undefined | null>,
    );
    if (!relay) {
      return null;
    }
    return {
      jmapApiUrl,
      jmapAccountId: "",
      jmapBearerToken: "",
      stalwartImpersonation: {
        allDomainLower: normalizeMailDomain(allDomainRaw),
        relayAccountEmail: relay.relayEmail,
        relayAccountPassword: relay.relayPassword,
      },
    };
  }

  return {
    jmapApiUrl,
    jmapAccountId: "",
    jmapBearerToken: "",
  };
}

type RuntimeSecretBindings = Record<string, string | undefined>;
const FORBIDDEN_DYNAMIC_CREDENTIAL_ENV_KEYS = [
  "POLITICIAN_JMAP_EMAIL",
  "POLITICIAN_JMAP_PASSWORD",
  "POLITICIAN_JMAP_TOKEN",
  "POLITICIAN_JMAP_ACCOUNT_ID",
  "STALWART_JMAP_EMAIL",
  "STALWART_JMAP_PASSWORD",
  "STALWART_JMAP_USERNAME",
  "STALWART_JMAP_TOKEN",
] as const;

const processEnv: Record<string, string | undefined> | undefined =
  typeof process !== "undefined" && process.env
    ? (process.env as Record<string, string | undefined>)
    : undefined;

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
  errors: Array<{ message_id: number; error: string }>;
}

interface SendContext {
  supporterId: number | null;
}

/**
 * Main worker function to process and send scheduled replies.
 * Groups messages by politician to reuse JMAP authentication/connections.
 */
export async function processScheduledReplies(
  db: DatabaseClient,
  runtimeSecrets?: RuntimeSecretBindings,
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
      const politicianResult = await processPoliticianBatch(
        db,
        politicianId,
        batch,
        runtimeSecrets,
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
async function processPoliticianBatch(
  db: DatabaseClient,
  politicianId: number,
  messages: MessageToProcess[],
  runtimeSecrets?: RuntimeSecretBindings,
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
    const jmapResolve = await resolveSingleServiceAccountConfig(runtimeSecrets);
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
          await processSingleMessage(db, message, {
            politician,
            jmapConfig: jmapResolve.config,
            campaignCache,
            templateCache,
            jmapClientCache,
            jmapEmailCache,
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
  runtimeSecrets?: RuntimeSecretBindings,
): Promise<ProcessingResult> {
  const result: ProcessingResult = {
    total: 1,
    sent: 0,
    failed: 0,
    errors: [],
  };

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

    const politician = await getPoliticianById(db, politicianId);
    if (!politician) {
      throw new Error(`Politician ${politicianId} not found`);
    }

    // Still resolve auth per immediate call (CLI/Web-hook context)
    const jmapResolve = await resolveSingleServiceAccountConfig(runtimeSecrets);
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
    const imp = jmapResolve.config.stalwartImpersonation;
    const fetchClientKey = imp ? `imp:${politician.email}` : "relay:default";

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

    await processSingleMessage(db, messageToProcess, {
      politician,
      jmapConfig: jmapResolve.config,
      jmapEmailCache: new Map([[message.external_id, jmapEmail]]),
      jmapClientCache: new Map([[fetchClientKey, server]]),
    });

    result.sent = 1;
    return result;
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : "Unknown error";
    result.failed = 1;
    result.errors.push({ message_id: messageId, error: errorMsg });
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

interface BatchProcessingContext {
  politician: {
    id: number;
    email: string;
    name: string;
    reply_to: string | null;
  };
  jmapConfig: WorkerConfig;
  campaignCache?: Map<number, any>;
  templateCache?: Map<number, any>;
  jmapClientCache?: Map<string, JMAPClient>;
  jmapEmailCache?: Map<string, EmailMessage>;
}

/**
 * Processes a single message using pre-resolved context (politician, JMAP auth).
 */
async function processSingleMessage(
  db: DatabaseClient,
  message: MessageToProcess,
  context: BatchProcessingContext,
): Promise<void> {
  const {
    politician,
    jmapConfig,
    campaignCache,
    templateCache,
    jmapClientCache,
    jmapEmailCache,
  } = context;

  // 1. Get template (cached if in batch)
  let template = templateCache?.get(message.campaign_id);
  if (!template) {
    console.log("fetch template", politician.id, message.campaign_id);
    template = await db.getActiveTemplateForCampaign(
      message.campaign_id,
      politician.id,
    );
    if (!template) {
      const errorMsg = `No active template found for campaign ${message.campaign_id}`;
      //      await handleSendFailure(db, message, errorMsg); this isn't a processing error, just bug on our side
      throw new Error(errorMsg);
    }
    templateCache?.set(message.campaign_id, template);
  }
  console.log("template to use", template);
  // 2. Apply schedule check
  /*  const replySchedule = await applyReplyScheduleForMessage(db, message.id);
  if (!replySchedule) {
    const errorMsg = `Message ${message.id} is not eligible for auto-reply`;
    await handleSendFailure(db, message, errorMsg);
    throw new Error(errorMsg);
  }
  if (!isReadyToSend(replySchedule.reply_scheduled_at)) {
    const errorMsg = `Reply for message ${message.id} is scheduled for later`;
    await handleSendFailure(db, message, errorMsg);
    throw new Error(errorMsg);
  }
*/

  // 3. Resolve recipient email
  const jmapEmail = jmapEmailCache?.get(message.external_id);
  const senderEmail = jmapEmail?.replyTo || jmapEmail?.from;
  if (!senderEmail) {
    const errorMsg = `Short-term contact email not found for message ${message.id} (JMAP ID ${message.external_id})`;
    await handleSendFailure(db, message, errorMsg);
    throw new Error(errorMsg);
  }

  // 4. Get campaign (cached if in batch)
  let campaign = campaignCache?.get(message.campaign_id);
  if (!campaign) {
    campaign = await getCampaignById(db, message.campaign_id);
    if (!campaign) {
      const errorMsg = `Campaign ${message.campaign_id} not found`;
      await handleSendFailure(db, message, errorMsg);
      throw new Error(errorMsg);
    }
    campaignCache?.set(message.campaign_id, campaign);
  }

  // 5. Resolve outbound identity
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
    if (!emailHostedOnDomain(outboundIdentity.fromEmail, imp.allDomainLower)) {
      const errorMsg = `ALL_DOMAIN is ${imp.allDomainLower} but outbound From is not on that domain`;
      await handleSendFailure(db, message, errorMsg);
      throw new Error(errorMsg);
    }
  }

  // 6. Resolve/Reuse JMAP client
  const clientKey = imp ? `imp:${outboundIdentity.fromEmail}` : "relay:default";
  let jmapClient = jmapClientCache?.get(clientKey);
  if (!jmapClient) {
    jmapClient = createJMAPClient(jmapConfig, outboundIdentity.fromEmail);
    jmapClientCache?.set(clientKey, jmapClient);
  }

  const sendContext = await buildSendContext(db, message, outboundIdentity);

  // 7. Resolve template tokens
  const tokens = {
    subject: jmapEmail?.subject || "",
    sender: jmapEmail?.fromName || jmapEmail?.from || "",
    date: jmapEmail?.receivedAt
      ? new Date(jmapEmail.receivedAt).toLocaleDateString()
      : "",
  };

  const personalizedSubject = replaceTokens(template.subject, tokens);
  const personalizedBody = replaceTokens(template.body, tokens);

  // 8. Render and build email
  const emailContent = renderEmailLayout({
    subject: personalizedSubject,
    markdown_body: personalizedBody,
    layout_type: template.layout_type,
    campaign_name: campaign?.name,
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
  if (jmapEmail?.headerMessageId) {
    email.inReplyTo = [jmapEmail.headerMessageId];
    email.references = [jmapEmail.headerMessageId];
  }

  // 9. Send via JMAP
  const sendResult = await jmapClient.sendEmail(email);

  if (!sendResult.success) {
    const errorMsg = "JMAP send failed";
    console.error(
      `[Reply Worker] ✗ Failed to send reply for message ${message.id}: ${errorMsg}`,
    );
    await handleSendFailure(db, message, errorMsg);
    throw new Error(errorMsg);
  }

  // 10. Log success and finalize
  console.log(
    `[Reply Worker] ✓ Sent reply for message ${message.id} (Provider ID: ${sendResult.messageId})`,
  );

  await db.markMessageReplyDelivered(message.id);
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

async function resolveSingleServiceAccountConfig(
  runtimeSecrets?: RuntimeSecretBindings,
): Promise<JmapResolveResult> {
  const mergedBindings: MailSendBindings = {
    ...(processEnv || {}),
    ...(runtimeSecrets || {}),
  };
  assertNoDynamicCredentialOverrides(mergedBindings as RuntimeSecretBindings);
  const baseConfig = resolveStalwartJmapWorkerConfig(mergedBindings);
  if (!baseConfig) {
    const allDomainHint = (mergedBindings.ALL_DOMAIN || "").trim()
      ? " For ALL_DOMAIN mode, set JMAP_URL plus RELAY_SERVICE_ACCOUNT_EMAIL and RELAY_SERVICE_ACCOUNT_PASSWORD."
      : "";
    return {
      ok: false,
      reason:
        "Single JMAP relay service account is not configured. Set JMAP_URL (base mail server URL)." +
        allDomainHint,
    };
  }

  if (baseConfig.stalwartImpersonation) {
    return {
      ok: true,
      config: baseConfig,
    };
  }

  const relayToken = await getSupabaseRelayAccessToken(
    mergedBindings as RuntimeSecretBindings,
  );
  if (!relayToken) {
    return {
      ok: false,
      reason:
        "Supabase IdP relay auth is required. Set SUPABASE_URL, SUPABASE_ANON_KEY, RELAY_SERVICE_ACCOUNT_EMAIL, and RELAY_SERVICE_ACCOUNT_PASSWORD.",
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

function assertNoDynamicCredentialOverrides(env: RuntimeSecretBindings): void {
  const forbidden = FORBIDDEN_DYNAMIC_CREDENTIAL_ENV_KEYS.filter(
    (key) => (env[key] || "").trim().length > 0,
  );
  if (forbidden.length > 0) {
    throw new Error(
      "Dynamic/per-entity outbound credentials are forbidden; use only the single relay account configuration.",
    );
  }
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
        imp.relayAccountEmail,
        targetEmail,
      ),
      basicPassword: imp.relayAccountPassword,
    });
  }

  return new JMAPClient({
    apiUrl: config.jmapApiUrl,
    accountId: config.jmapAccountId,
    bearerToken: config.jmapBearerToken,
  });
}
