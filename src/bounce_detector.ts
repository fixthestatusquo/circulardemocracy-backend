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
