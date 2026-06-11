/**
 * Bounce detection for Stalwart-fetched emails.
 *
 * Bounce (DSN) emails are detected by From address and Subject heuristics.
 * When a sent reply bounces, the DSN contains the original email as a
 * message/rfc822 attachment.  By setting a custom Message-ID on each
 * outgoing reply (via dxid-encoded message ID), we can reliably match
 * the bounce back to the original message.
 */

import { decode32 } from "dxid";

// Common DSN sender patterns (case-insensitive substring match)
const DSN_FROM_PATTERNS = [
  "mailer-daemon",
  "mail delivery subsystem",
  "mail delivery system",
  "postmaster",
  "MAILER-DAEMON",
];

// Common DSN subject patterns (case-insensitive substring match)
const DSN_SUBJECT_PATTERNS = [
  "undelivered",
  "undeliverable",
  "delivery status",
  "delivery failure",
  "delivery notification",
  "non-delivery",
  "returned mail",
  "returned to sender",
  "failure notice",
  "bounce",
];

const REPLY_MESSAGE_ID_RE = /^Message-ID:\s*<?reply-([A-Za-z0-9]+)@/im;

// Header patterns for automated replies (case-insensitive)
const AUTO_REPLY_HEADERS = [
  { name: "auto-submitted", value: "auto-replied" },
  { name: "auto-submitted", value: "auto-generated" },
  { name: "x-autoreply", value: "yes" },
  { name: "x-autorespond", value: "yes" },
  { name: "precedence", value: "auto_reply" },
  { name: "precedence", value: "bulk" },
  { name: "precedence", value: "junk" },
];

// Subject patterns for auto-replies
const AUTO_REPLY_SUBJECT_RE = /^(auto-?reply|automatic reply|out of office|out of the office)/i;

/**
 * Check whether a JMAP email looks like a bounce/DSN based on its
 * From address and Subject — fields that are already available without
 * additional JMAP queries.
 */
export function isBounceEmail(email: {
  from?: Array<{ email?: string; name?: string }>;
  subject?: string;
}): boolean {
  // Check From address
  const fromEmail = email.from?.[0]?.email?.toLowerCase() || "";
  const fromName = email.from?.[0]?.name?.toLowerCase() || "";
  const fromText = `${fromEmail} ${fromName}`;

  for (const pattern of DSN_FROM_PATTERNS) {
    if (fromText.includes(pattern.toLowerCase())) {
      return true;
    }
  }

  // Check Subject line
  const subject = email.subject || "";
  const lowerSubject = subject.toLowerCase();

  for (const pattern of DSN_SUBJECT_PATTERNS) {
    if (lowerSubject.includes(pattern.toLowerCase())) {
      return true;
    }
  }

  return false;
}

/**
 * Extract the internal message ID from the raw text of a bounced email
 * (the message/rfc822 attachment inside the DSN).
 *
 * Looks for a Message-ID header matching the pattern:
 *   <reply-{dxid}@{domain}>
 *
 * Returns the numeric message.id, or null if no match is found.
 */
export function extractBouncedMessageId(blobText: string): number | null {
  const match = REPLY_MESSAGE_ID_RE.exec(blobText);
  if (!match) {
    return null;
  }

  try {
    const dxid = match[1];
    const id = decode32(dxid);
    return typeof id === "number" && Number.isFinite(id) ? id : null;
  } catch {
    return null;
  }
}

/**
 * Check whether an email is an auto-reply / out-of-office / automatic
 * response that should not be processed as a constituent message.
 *
 * Uses both Subject heuristics and JMAP Email headers (when available).
 */
export function isAutoReply(email: {
  subject?: string;
  headers?: Array<{ name?: string; value?: string }>;
}): boolean {
  // Check subject line
  if (email.subject && AUTO_REPLY_SUBJECT_RE.test(email.subject.trim())) {
    return true;
  }

  // Check JMAP Email headers (fetched when "headers" is in Email/get properties)
  if (email.headers && email.headers.length > 0) {
    for (const { name: headerName, value: headerValue } of email.headers) {
      if (!headerName || !headerValue) continue;
      const lowerName = headerName.toLowerCase();
      const lowerValue = headerValue.toLowerCase();
      for (const pattern of AUTO_REPLY_HEADERS) {
        if (lowerName === pattern.name && lowerValue.startsWith(pattern.value)) {
          return true;
        }
      }
    }
  }

  return false;
}
