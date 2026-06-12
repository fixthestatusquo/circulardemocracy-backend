import type { DatabaseClient } from "./database.js";

export interface CliFilters {
  campaignId?: number;
  campaignName?: string;
  politicianId?: number;
  politicianName?: string;
  dryRun?: boolean;
  limit?: number;
  messageId?: string;
  desc?: boolean;
  recover?: boolean;
}

export async function resolveCampaignId(
  db: DatabaseClient,
  options: Pick<CliFilters, "campaignId" | "campaignName">,
): Promise<number | undefined> {
  if (options.campaignId !== undefined) {
    const campaign = await db.getCampaignById(options.campaignId);
    if (!campaign) {
      throw new Error(`Campaign not found: id ${options.campaignId}`);
    }
    return campaign.id;
  }

  if (options.campaignName) {
    const campaign = await db.findCampaignByHint(options.campaignName);
    if (!campaign) {
      throw new Error(`No campaign matched name hint: ${options.campaignName}`);
    }
    return campaign.id;
  }

  return undefined;
}

export async function resolvePoliticianId(
  db: DatabaseClient,
  options: Pick<CliFilters, "politicianId" | "politicianName">,
): Promise<number | undefined> {
  if (options.politicianId !== undefined) {
    const politician = await db.getPoliticianById(options.politicianId);
    if (!politician) {
      throw new Error(`Politician not found: id ${options.politicianId}`);
    }
    return politician.id;
  }

  if (options.politicianName) {
    const politician = await db.findPoliticianByEmail(options.politicianName);
    if (!politician) {
      throw new Error(
        `No politician matched name/email hint: ${options.politicianName}`,
      );
    }
    return politician.id;
  }

  return undefined;
}
