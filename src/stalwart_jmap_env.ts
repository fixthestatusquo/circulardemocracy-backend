import type { WorkerConfig } from "./reply_worker";

/**
 * Environment / Worker bindings for Stalwart JMAP outbound mail.
 * Prefer STALWART_* (local .env); JMAP_* remains supported for older Cloudflare secrets.
 */
export type MailSendBindings = {
  STALWART_JMAP_ENDPOINT?: string;
  STALWART_JMAP_ACCOUNT_ID?: string;
  STALWART_USERNAME?: string;
  STALWART_APP_PASSWORD?: string;
  STALWART_PASSWORD?: string;
  JMAP_API_URL?: string;
  JMAP_ACCOUNT_ID?: string;
  JMAP_USERNAME?: string;
  JMAP_PASSWORD?: string;
};

/**
 * Returns WorkerConfig when all required values are present, else null.
 */
export function resolveStalwartJmapWorkerConfig(
  env: MailSendBindings,
): WorkerConfig | null {
  const jmapApiUrl = (
    env.STALWART_JMAP_ENDPOINT?.trim() ||
    env.JMAP_API_URL?.trim() ||
    ""
  ).trim();
  const jmapAccountId = (
    env.STALWART_JMAP_ACCOUNT_ID?.trim() ||
    env.JMAP_ACCOUNT_ID?.trim() ||
    ""
  ).trim();
  const jmapUsername = (
    env.STALWART_USERNAME?.trim() ||
    env.JMAP_USERNAME?.trim() ||
    ""
  ).trim();
  const jmapPassword = (
    env.STALWART_APP_PASSWORD?.trim() ||
    env.STALWART_PASSWORD?.trim() ||
    env.JMAP_PASSWORD?.trim() ||
    ""
  ).trim();

  if (!jmapApiUrl || !jmapAccountId || !jmapUsername || !jmapPassword) {
    return null;
  }

  return {
    jmapApiUrl,
    jmapAccountId,
    jmapUsername,
    jmapPassword,
  };
}
