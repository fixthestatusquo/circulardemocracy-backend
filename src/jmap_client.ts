// JMAP Client — thin wrapper around jmap-cli for backward compatibility.
// For direct use (bin/fetch.ts), import JmapClient from jmap-cli directly.

import { JmapClient as UpstreamClient } from "jmap-cli";
import { normalizeEmailSubject } from "./email_subject";
import type { JmapMessage } from "jmap-cli";

/**
 * JMAP session document URL from `JMAP_URL` (trimmed, no trailing slash) + `/.well-known/jmap`.
 */
export function jmapWellKnownSessionUrl(
  env: Record<string, string | undefined | null>,
): string | null {
  const base = String(env.JMAP_URL ?? "")
    .trim()
    .replace(/\/+$/, "");
  if (!base) {
    return null;
  }
  return `${base}/.well-known/jmap`;
}

export interface JMAPConfig {
  apiUrl: string;
  /** JMAP mail account id. When empty, resolved from session. */
  accountId: string;
  bearerToken?: string;
  /** Stalwart impersonation: targetMailbox%relayAccount */
  basicUsername?: string;
  basicPassword?: string;
}

export interface EmailMessage {
  from: string;
  fromName?: string;
  to: string[];
  replyTo?: string;
  subject: string;
  textBody?: string;
  htmlBody?: string;
  inReplyTo?: string[];
  references?: string[];
  receivedAt?: string;
  sentAt?: string;
  messageId?: [string];
}

export interface JMAPSendResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

export function resolveMailAccountIdFromSession(session: {
  primaryAccounts?: Record<string, string>;
}): string {
  const mailId =
    (session.primaryAccounts &&
      session.primaryAccounts["urn:ietf:params:jmap:mail"]) ||
    "";
  if (!mailId) {
    throw new Error("No JMAP mail account found in session response");
  }
  return mailId;
}

/** Convert our JMAPConfig to jmap-cli JmapClientOptions. */
function toUpstreamOptions(config: JMAPConfig) {
  const baseUrl = config.apiUrl.replace(/\/\.well-known\/jmap\/?$/, "").replace(/\/jmap\/?$/, "");

  if (config.basicUsername && config.basicPassword) {
    // Stalwart impersonation: basicUsername = "target%relay"
    const [impersonate, login] = config.basicUsername.split("%");
    return {
      baseUrl,
      login: login || impersonate,
      password: config.basicPassword,
      impersonate: login ? impersonate : undefined,
    };
  }

  if (config.bearerToken) {
    return { baseUrl, token: config.bearerToken };
  }

  return { baseUrl };
}

export class JMAPClient {
  private upstream: UpstreamClient;
  private config: JMAPConfig;

  constructor(config: JMAPConfig) {
    this.config = config;
    this.upstream = new UpstreamClient(toUpstreamOptions(config));
  }

  async sendEmail(email: EmailMessage): Promise<JMAPSendResult> {
    try {
      const result = await this.upstream.sendEmail({
        from: email.from,
        fromName: email.fromName || email.from.split("@")[0],
        to: email.to,
        subject: normalizeEmailSubject(email.subject),
        text: email.textBody || "",
        html: email.htmlBody,
        replyTo: email.replyTo,
        inReplyTo: email.inReplyTo?.[0],
        references: email.references,
      });

      const emailSetResponse = (result as any)?.methodResponses?.[0]?.[1];
      const createdEntry = emailSetResponse?.created;
      const createdKey = createdEntry ? Object.keys(createdEntry)[0] : undefined;
      const messageId = createdKey ? createdEntry[createdKey]?.id : undefined;

      return {
        success: true,
        messageId,
      };
    } catch (error) {
      console.error("JMAP sendEmail failed:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  /** Fetch emails by JMAP IDs. Returns a Map keyed by id. */
  async getEmails(ids: string[]): Promise<Map<string, EmailMessage>> {
    const result = new Map<string, EmailMessage>();
    if (ids.length === 0) return result;

    try {
      const messages = await this.upstream.getMessages({ messageIds: ids });

      for (const item of messages) {
        const from = item.from?.[0];
        const replyTo = item.replyTo?.[0];
        result.set(item.id, {
          from: from?.email || "",
          fromName: from?.name || "",
          to: (item.to || []).map((a) => a.email),
          replyTo: replyTo?.email || undefined,
          subject: item.subject || "",
          messageId: item.messageID ? [item.messageID] : undefined,
          sentAt: item.sentAt,
          receivedAt: item.receivedAt,
          textBody: typeof item.textBody === "string" ? item.textBody : undefined,
          htmlBody: typeof item.htmlBody === "string" ? item.htmlBody : undefined,
        });
      }

      return result;
    } catch (error) {
      console.error("JMAP getEmails failed:", error);
      throw error;
    }
  }

  /** Tests the JMAP connection. */
  async testConnection(): Promise<boolean> {
    try {
      return await this.upstream.verifyCredentials();
    } catch {
      return false;
    }
  }
}

// Re-export the upstream type for direct consumers
export type { JmapMessage };
