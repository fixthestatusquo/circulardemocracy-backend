/**
 * Normalize outbound email subjects: trim whitespace and decode RFC 2047
 * encoded-words so Stalwart does not re-encode pre-wrapped MIME subjects.
 *
 * Call sites (keep in sync):
 * - template_service: on create/update (canonical DB value)
 * - jmap_client.buildEmailObject: on send (covers legacy rows)
 */

const ENCODED_WORD_RE =
  /=\?([\w*-]+)\?([BbQq])\?((?:[^?]|\?(?!=))*)\?=/g;

function decodeQuotedPrintableWord(encoded: string): string {
  const bytes: number[] = [];
  for (let i = 0; i < encoded.length; i++) {
    const ch = encoded[i];
    if (ch === "_") {
      bytes.push(0x20);
    } else if (ch === "=" && i + 2 < encoded.length) {
      bytes.push(Number.parseInt(encoded.slice(i + 1, i + 3), 16));
      i += 2;
    } else {
      bytes.push(ch.charCodeAt(0));
    }
  }
  return Buffer.from(bytes).toString("utf8");
}

function decodeBase64Word(encoded: string): string {
  const compact = encoded.replace(/\s+/g, "");
  return Buffer.from(compact, "base64").toString("utf8");
}

function decodeEncodedWord(encoding: string, encodedText: string): string {
  if (encoding.toUpperCase() === "B") {
    return decodeBase64Word(encodedText);
  }
  return decodeQuotedPrintableWord(encodedText);
}

/**
 * Returns a plain UTF-8 subject suitable for JMAP Email/set (no RFC 2047 wrapping).
 */
export function normalizeEmailSubject(subject: string): string {
  const trimmed = subject.trim();
  if (!trimmed.includes("=?")) {
    return trimmed;
  }

  const unfolded = trimmed.replace(/\r?\n\s+/g, "");
  const decoded = unfolded.replace(
    ENCODED_WORD_RE,
    (_match, _charset, encoding, encodedText) =>
      decodeEncodedWord(encoding, encodedText),
  );

  return decoded.trim();
}
