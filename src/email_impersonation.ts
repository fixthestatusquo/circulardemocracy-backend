/**
 * Outbound email identity for “send as politician” (impersonation at the MIME/JMAP layer).
 * From / Reply-To are derived only from database rows, never from untrusted client strings.
 */

export interface PoliticianIdentityRow {
  id: number;
  name: string;
  email: string;
  reply_to?: string | null;
}

export interface CampaignIdentityRow {
  technical_email: string | null;
  reply_to_email: string | null;
}

export interface ResolvedOutboundIdentity {
  fromEmail: string;
  fromDisplayName: string;
  replyToEmail: string;
}

/**
 * Resolves From / Reply-To / display name from campaign + politician tables.
 * Returns null if a required address is missing (caller should fail the send).
 */
export function resolveOutboundEmailIdentity(
  politician: PoliticianIdentityRow,
  campaign: CampaignIdentityRow,
): ResolvedOutboundIdentity | null {
  const fromEmail = (
    campaign.technical_email?.trim() ||
    politician.email?.trim() ||
    ""
  ).trim();
  const replyToEmail = (
    campaign.reply_to_email?.trim() ||
    politician.reply_to?.trim() ||
    politician.email?.trim() ||
    ""
  ).trim();
  if (!fromEmail || !replyToEmail) {
    return null;
  }
  const rawName = politician.name?.trim();
  const fromDisplayName =
    rawName && rawName.length > 0
      ? rawName
      : fromEmail.split("@")[0] || fromEmail;
  return {
    fromEmail,
    fromDisplayName,
    replyToEmail,
  };
}
