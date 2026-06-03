/**
 * Stalwart JMAP helpers: Basic auth, impersonation login, and DEFAULT_DOMAIN utilities.
 */

export interface StalwartImpersonationConfig {
  /** Lowercase default mail domain without leading `@`, e.g. `example.org`. */
  defaultDomainLower: string;
  /** Stalwart admin account (`JMAP_ADMIN_EMAIL`). */
  adminEmail: string;
  adminPassword: string;
}

export interface JmapAdminCredentials {
  adminEmail: string;
  adminPassword: string;
}

export function encodeBasicAuth(username: string, password: string): string {
  const token = Buffer.from(`${username}:${password}`).toString("base64");
  return `Basic ${token}`;
}

/**
 * Stalwart impersonation login: `{@link targetMailbox}%{@link adminAccount}`.
 * Password must be {@link adminAccount}'s login password (`JMAP_ADMIN_PASSWORD`).
 * @see https://stalw.art/docs/auth/authorization/administrator
 */
export function buildStalwartImpersonationLogin(
  adminAccount: string,
  targetMailbox: string,
): string {
  return `${targetMailbox.trim()}%${adminAccount.trim()}`;
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

/** Credentials for `target%admin` impersonation from `JMAP_ADMIN_EMAIL` / `JMAP_ADMIN_PASSWORD`. */
export function resolveJmapAdminCredentials(
  env: Record<string, string | undefined | null>,
): JmapAdminCredentials | null {
  const adminEmail = String(env.JMAP_ADMIN_EMAIL ?? "").trim();
  const adminPassword = String(env.JMAP_ADMIN_PASSWORD ?? "").trim();
  if (!adminEmail || !adminPassword) {
    return null;
  }
  return { adminEmail, adminPassword };
}
