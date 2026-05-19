/**
 * Stalwart JMAP helpers: Basic auth, impersonation login, and ALL_DOMAIN utilities.
 */

export interface StalwartImpersonationConfig {
  /** Lowercase domain without leading `@`, e.g. `example.org`. */
  allDomainLower: string;
  /** Relay service account (`RELAY_SERVICE_ACCOUNT_EMAIL`). */
  relayAccountEmail: string;
  relayAccountPassword: string;
}

export interface RelayImpersonationCredentials {
  relayEmail: string;
  relayPassword: string;
}

export function encodeBasicAuth(username: string, password: string): string {
  const token = Buffer.from(`${username}:${password}`).toString("base64");
  return `Basic ${token}`;
}

/**
 * Stalwart impersonation login: `{@link targetMailbox}%{@link relayAccount}`.
 * Password must be {@link relayAccount}'s login password (`RELAY_SERVICE_ACCOUNT_PASSWORD`).
 * @see https://stalw.art/docs/auth/authorization/administrator
 */
export function buildStalwartImpersonationLogin(
  relayAccount: string,
  targetMailbox: string,
): string {
  return `${targetMailbox.trim()}%${relayAccount.trim()}`;
}

export function normalizeMailDomain(domain: string): string {
  return domain.trim().toLowerCase().replace(/^@/, "");
}

export function emailHostedOnDomain(
  email: string,
  domainLower: string,
): boolean {
  const e = email.trim().toLowerCase();
  return e.endsWith(`@${domainLower}`);
}

/** Credentials for `target%relay` impersonation from `.env` relay service account. */
export function resolveRelayImpersonationCredentials(
  env: Record<string, string | undefined | null>,
): RelayImpersonationCredentials | null {
  const relayEmail = String(env.RELAY_SERVICE_ACCOUNT_EMAIL ?? "").trim();
  const relayPassword = String(
    env.RELAY_SERVICE_ACCOUNT_PASSWORD ?? "",
  ).trim();
  if (!relayEmail || !relayPassword) {
    return null;
  }
  return { relayEmail, relayPassword };
}
