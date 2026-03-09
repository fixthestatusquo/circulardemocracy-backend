import { z } from "zod";
import type { MessageInput } from "./message_processor";
import { processMessage, type Ai, type MessageProcessingResult } from "./message_processor";
import type { DatabaseClient } from "./database";

export const StalwartHookSchema = z.object({
  context: z.object({}).passthrough().optional(),
  envelope: z.object({
    from: z.string().email(),
    to: z.array(z.string().email()),
  }),
  message: z.object({
    headers: z.record(z.string(), z.union([z.string(), z.array(z.string())])),
    subject: z.string().optional(),
    body: z
      .object({
        text: z.string().optional(),
        html: z.string().optional(),
      })
      .optional(),
  }),
  messageId: z.string().optional(),
  timestamp: z.number().optional(),
});

export type StalwartHookPayload = z.infer<typeof StalwartHookSchema>;

export type SenderFlag = "normal" | "replyToDiffers" | "suspicious";

export interface StalwartAdapterResult {
  messageInput: MessageInput;
  senderFlag: SenderFlag;
  isReply: boolean;
}

function getHeader(
  headers: Record<string, string | string[]>,
  name: string,
): string | null {
  const value = headers[name.toLowerCase()];
  return Array.isArray(value) ? value[0] || null : value || null;
}

function extractEmailFromHeader(headerValue: string): string | null {
  const emailMatch = headerValue.match(/<([^>]+)>/) || [null, headerValue];
  const email = emailMatch[1]?.trim() || headerValue.trim();
  return email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}

function extractNameFromHeader(headerValue: string): string {
  const nameMatch = headerValue.match(/^([^<]+)</);
  if (nameMatch) {
    return nameMatch[1].trim().replace(/^["']|["']$/g, "");
  }
  return "";
}

function htmlToMarkdown(html: string): string {
  let text = html;

  text = text.replace(/<br\s*\/?>/gi, "\n");
  text = text.replace(/<\/p>/gi, "\n\n");
  text = text.replace(/<p[^>]*>/gi, "");

  text = text.replace(/<strong[^>]*>(.*?)<\/strong>/gi, "**$1**");
  text = text.replace(/<b[^>]*>(.*?)<\/b>/gi, "**$1**");
  text = text.replace(/<em[^>]*>(.*?)<\/em>/gi, "*$1*");
  text = text.replace(/<i[^>]*>(.*?)<\/i>/gi, "*$1*");

  text = text.replace(/<a[^>]*href=["']([^"']*)["'][^>]*>(.*?)<\/a>/gi, "[$2]($1)");

  text = text.replace(/<h1[^>]*>(.*?)<\/h1>/gi, "# $1\n\n");
  text = text.replace(/<h2[^>]*>(.*?)<\/h2>/gi, "## $1\n\n");
  text = text.replace(/<h3[^>]*>(.*?)<\/h3>/gi, "### $1\n\n");

  text = text.replace(/<li[^>]*>(.*?)<\/li>/gi, "- $1\n");
  text = text.replace(/<\/?ul[^>]*>/gi, "\n");
  text = text.replace(/<\/?ol[^>]*>/gi, "\n");

  text = text.replace(/<[^>]*>/g, "");

  text = text.replace(/&nbsp;/g, " ");
  text = text.replace(/&amp;/g, "&");
  text = text.replace(/&lt;/g, "<");
  text = text.replace(/&gt;/g, ">");
  text = text.replace(/&quot;/g, '"');
  text = text.replace(/&#39;/g, "'");

  text = text.replace(/\n{3,}/g, "\n\n");
  text = text.replace(/[ \t]+/g, " ");

  return text.trim();
}

function extractBody(payload: StalwartHookPayload): string {
  const htmlContent = payload.message.body?.html;
  if (htmlContent && htmlContent.trim().length > 0) {
    return htmlToMarkdown(htmlContent);
  }

  const textContent = payload.message.body?.text;
  if (textContent && textContent.trim().length > 0) {
    return textContent.trim();
  }

  return "";
}

function extractCampaignHint(recipientEmail: string, subject: string): string | undefined {
  const aliasMatch = recipientEmail.match(/^([^+@]+)\+([^@]+)@/);
  if (aliasMatch && aliasMatch[2]) {
    return aliasMatch[2].trim();
  }

  const subjectTagMatch = subject.match(/\[([^\]]+)\]/);
  if (subjectTagMatch && subjectTagMatch[1]) {
    return subjectTagMatch[1].trim();
  }

  return undefined;
}

function detectReply(headers: Record<string, string | string[]>): boolean {
  const inReplyTo = getHeader(headers, "in-reply-to");
  const references = getHeader(headers, "references");
  const subject = getHeader(headers, "subject");

  if (inReplyTo || references) {
    return true;
  }

  if (subject && /^(re:|fwd:|fw:)/i.test(subject.trim())) {
    return true;
  }

  return false;
}

function determineSenderFlag(
  replyToEmail: string | null,
  fromEmail: string | null,
  envelopeSender: string,
): SenderFlag {
  if (!replyToEmail) {
    return "normal";
  }

  const normalizedReplyTo = replyToEmail.toLowerCase();
  const normalizedFrom = fromEmail?.toLowerCase() || null;
  const normalizedEnvelope = envelopeSender.toLowerCase();

  if (normalizedReplyTo !== normalizedFrom && normalizedReplyTo !== normalizedEnvelope) {
    return "replyToDiffers";
  }

  if (normalizedReplyTo !== normalizedEnvelope) {
    return "suspicious";
  }

  return "normal";
}

export function adaptStalwartHookToMessageInput(
  payload: StalwartHookPayload,
): StalwartAdapterResult {
  const headers = payload.message.headers;

  const replyToHeader = getHeader(headers, "reply-to");
  const fromHeader = getHeader(headers, "from");
  const envelopeSender = payload.envelope.from;

  const replyToEmail = replyToHeader ? extractEmailFromHeader(replyToHeader) : null;
  const fromEmail = fromHeader ? extractEmailFromHeader(fromHeader) : null;

  let senderEmail: string;
  let senderName: string = "";

  if (replyToEmail) {
    senderEmail = replyToEmail;
    if (replyToHeader) {
      senderName = extractNameFromHeader(replyToHeader);
    }
  } else if (fromEmail) {
    senderEmail = fromEmail;
    if (fromHeader) {
      senderName = extractNameFromHeader(fromHeader);
    }
  } else {
    senderEmail = envelopeSender;
  }

  if (!senderName && fromHeader) {
    senderName = extractNameFromHeader(fromHeader);
  }

  if (!senderName) {
    senderName = senderEmail.split("@")[0];
  }

  const recipientEmail = payload.envelope.to[0] || "";

  const subject = payload.message.subject || "";

  const body = extractBody(payload);

  const externalId = payload.messageId || `stalwart-${Date.now()}-${Math.random().toString(36).substring(7)}`;

  const timestamp = payload.timestamp
    ? new Date(payload.timestamp * 1000).toISOString()
    : new Date().toISOString();

  const senderFlag = determineSenderFlag(replyToEmail, fromEmail, envelopeSender);

  const campaignHint = extractCampaignHint(recipientEmail, subject);

  const isReply = detectReply(headers);

  const messageInput: MessageInput = {
    external_id: externalId,
    sender_name: senderName,
    sender_email: senderEmail,
    recipient_email: recipientEmail,
    subject: subject,
    message: body,
    timestamp: timestamp,
    channel_source: "stalwart",
    campaign_hint: campaignHint,
    sender_flag: senderFlag,
    is_reply: isReply,
  };

  return {
    messageInput,
    senderFlag,
    isReply,
  };
}

export interface StalwartProcessingResult extends MessageProcessingResult {
  senderFlag: SenderFlag;
  campaign_hint?: string;
  isReply?: boolean;
}

export const StalwartResponseSchema = z.object({
  action: z.enum(["accept", "reject", "quarantine", "discard"]),
  modifications: z
    .object({
      folder: z.string().optional(),
      headers: z.record(z.string(), z.string()).optional(),
    })
    .optional(),
});

export type StalwartResponse = z.infer<typeof StalwartResponseSchema>;

export function mapToStalwartResponse(
  result: StalwartProcessingResult,
): StalwartResponse {
  if (!result.success) {
    if (result.status === "duplicate" && result.campaign_name) {
      return {
        action: "accept",
        modifications: {
          folder: `${result.campaign_name}/Duplicates`,
        },
      };
    }

    if (result.campaign_hint) {
      return {
        action: "accept",
        modifications: {
          folder: `${result.campaign_hint}/unprocessed`,
        },
      };
    }

    return {
      action: "accept",
    };
  }

  if (result.campaign_name) {
    const folderSuffix = result.isReply ? "replied" : "inbox";
    return {
      action: "accept",
      modifications: {
        folder: `${result.campaign_name}/${folderSuffix}`,
      },
    };
  }

  return {
    action: "accept",
  };
}

export async function processStalwartHook(
  db: DatabaseClient,
  ai: Ai,
  payload: StalwartHookPayload,
): Promise<StalwartProcessingResult> {
  const { messageInput, senderFlag, isReply } = adaptStalwartHookToMessageInput(payload);

  const result = await processMessage(db, ai, messageInput);

  return {
    ...result,
    senderFlag,
    campaign_hint: messageInput.campaign_hint,
    isReply,
  };
}
