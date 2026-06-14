#!/usr/bin/env -S ./node_modules/.bin/tsx

/**
 * Count delayed emails by recipient domain from the Delayed folder.
 *
 * Reads DSN emails in the Delayed folder, extracts the recipient domain
 * from the body/text, and shows a count per domain.
 */

import minimist from "minimist";
import { config as dotenv } from "dotenv";
import { DatabaseClient } from "../src/database.js";
import { JmapClient as UpstreamClient } from "jmap-cli";
import { jmapWellKnownSessionUrl } from "../src/jmap_client.js";
import { jmapQueryWithBodies } from "../src/jmap_query.js";
import {
  resolveRelayImpersonationCredentials,
  normalizeMailDomain,
} from "../src/stalwart_jmap.js";

dotenv();

// Extract domain from a DSN delay body like:
//   "<user@example.org> (host 'mx.example.com' ..."
const DOMAIN_RE = /<[^>]+@([^>]+)>/gm;

async function countDomains(
  db: DatabaseClient,
  politician: { id: number; email: string },
  baseUrl: string,
  relayCreds: { relayEmail: string; relayPassword: string },
): Promise<Map<string, number>> {
  const counts = new Map<string, number>();

  const client = new UpstreamClient({
    baseUrl,
    login: relayCreds.relayEmail,
    password: relayCreds.relayPassword,
    impersonate: politician.email,
  });

  const delayedMb = await client.getMailbox("delayed");
  if (!delayedMb?.id) return counts;

  let position = 0;

  while (true) {
    const result = await jmapQueryWithBodies(
      client, { inMailbox: delayedMb.id }, 50, position,
      ["id", "textBody", "htmlBody", "bodyValues"],
    );
    const { emails } = result;
    if (emails.length === 0) break;

    for (const email of emails) {
      const body = email.textBody || email.htmlBody || "";
      const domains = new Set<string>();

      // Extract domains from <user@domain> patterns
      for (const match of body.matchAll(DOMAIN_RE)) {
        domains.add(match[1].toLowerCase());
      }

      for (const domain of domains) {
        counts.set(domain, (counts.get(domain) || 0) + 1);
      }
    }

    position = result.position + emails.length;
  }

  return counts;
}

async function main() {
  const argv = minimist(process.argv.slice(2), {
    string: ["politician-id"],
    boolean: ["help"],
    alias: { h: "help" },
    unknown: (d: string) => {
      if (d[0] !== "-") return true;
      console.error(`Unknown option: ${d}`);
      process.exit(1);
    },
  });

  if (argv.help) {
    console.log(`
Usage: delayed-domains [--politician-id <id>]

Options:
  --politician-id <id>  Target single politician
  -h, --help            Show this help message

Without --politician-id, processes ALL politicians on ALL_DOMAIN.
`);
    return;
  }

  const supabaseUrl = process.env.SUPABASE_URL!;
  const supabaseKey = process.env.SUPABASE_KEY!;
  const jmapUrl = jmapWellKnownSessionUrl(process.env);
  if (!supabaseUrl || !supabaseKey || !jmapUrl) {
    console.error("Missing SUPABASE_URL, SUPABASE_KEY, or JMAP_URL");
    process.exit(1);
  }

  const db = new DatabaseClient({ url: supabaseUrl, key: supabaseKey });
  const baseUrl = jmapUrl.replace(/\/\.well-known\/jmap\/?$/, "");
  const relayCreds = resolveRelayImpersonationCredentials(process.env);

  if (!relayCreds) {
    console.error("Missing RELAY_SERVICE_ACCOUNT_EMAIL or RELAY_SERVICE_ACCOUNT_PASSWORD");
    process.exit(1);
  }

  let politicians: Array<{ id: number; email: string }>;

  if (argv["politician-id"]) {
    const id = Number(argv["politician-id"]);
    const p = await db.getPoliticianById(id);
    if (!p) { console.error(`Politician ${id} not found`); process.exit(1); }
    politicians = [{ id: p.id, email: p.email }];
  } else {
    const allDomainRaw = process.env.ALL_DOMAIN;
    if (!allDomainRaw) {
      console.error("Missing ALL_DOMAIN");
      process.exit(1);
    }
    const domainKey = normalizeMailDomain(allDomainRaw);
    const emails = await db.listStalwartMailboxAddressesForDomain(domainKey);
    const all = await Promise.all(emails.map((e) => db.findPoliticianByEmail(e)));
    politicians = all.filter(Boolean) as Array<{ id: number; email: string }>;
    console.log(`Processing ${politicians.length} politician(s) on @${domainKey}`);
  }

  const globalCounts = new Map<string, number>();

  for (const politician of politicians) {
    console.log(`\n📧 ${politician.email}...`);
    const counts = await countDomains(db, politician, baseUrl, relayCreds);
    for (const [domain, count] of counts) {
      globalCounts.set(domain, (globalCounts.get(domain) || 0) + count);
    }
    const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
    for (const [domain, count] of sorted) {
      console.log(`  ${domain}: ${count}`);
    }
  }

  if (politicians.length > 1) {
    console.log(`\n📊 Combined totals:`);
    const sorted = [...globalCounts.entries()].sort((a, b) => b[1] - a[1]);
    for (const [domain, count] of sorted) {
      console.log(`  ${domain}: ${count}`);
    }
  }
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
