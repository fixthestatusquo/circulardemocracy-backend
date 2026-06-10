#!/usr/bin/env bun

import { readFileSync } from "node:fs";
import { parse } from "csv-parse/sync";
import minimist from "minimist";
import { JmapClient } from "jmap-cli";
import { jmapWellKnownSessionUrl } from "../src/jmap_client.js";

interface CsvRow {
  first_name: string;
  last_name: string;
  email: string;
  area: string;
  campaign_name: string;
  target_name: string;
  msg_subject: string;
  msg_body: string;
  created_at: string;
}

interface ImportArgs {
  mailboxEmail: string;
  csvFile: string;
  limit: number | null;
  start: number;
  safe: boolean;
}

function parseArgs(): ImportArgs {
  const argv = minimist(process.argv.slice(2), {
    string: ["limit", "start"],
    boolean: ["help", "safe"],
    alias: { h: "help" },
    default: { safe: true, start: "0" },
    unknown: (d: string) => {
      if (d[0] !== "-") return true;
      console.error(`Unknown option: ${d}`);
      process.exit(1);
      return false;
    },
  });

  if (argv.help) {
    console.error(
      "Usage: npx tsx bin/import.ts <mailbox-email> <csv-file> [--limit N] [--start N] [--no-safe]",
    );
    process.exit(1);
  }

  const positional = argv._;
  const mailboxEmail: string | undefined = positional[0];
  const csvFile: string | undefined = positional[1];

  if (!mailboxEmail || !csvFile) {
    console.error(
      "Usage: npx tsx bin/import.ts <mailbox-email> <csv-file> [--limit N] [--start N] [--no-safe]",
    );
    process.exit(1);
  }

  const limit = argv.limit !== undefined ? Number(argv.limit) : null;
  if (limit !== null && (isNaN(limit) || limit < 1)) {
    console.error("Error: --limit must be a positive integer");
    process.exit(1);
  }

  const start = Number(argv.start);
  if (isNaN(start) || start < 0) {
    console.error("Error: --start must be a non-negative integer");
    process.exit(1);
  }

  return { mailboxEmail, csvFile, limit, start, safe: argv.safe };
}

async function main() {
  const { mailboxEmail, csvFile, limit, start, safe } = parseArgs();

  // Read and parse CSV
  const csvContent = readFileSync(csvFile, "utf-8");
  const rows: CsvRow[] = parse(csvContent, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    bom: true,
  });

  if (rows.length === 0) {
    console.error("Error: CSV file is empty");
    process.exit(1);
  }

  const sliced = start > 0 ? rows.slice(start) : rows;
  if (sliced.length === 0) {
    console.error(`Error: --start=${start} skips all ${rows.length} rows`);
    process.exit(1);
  }
  if (start > 0) {
    console.log(`Skipped first ${start} rows (${rows.length - sliced.length} of ${rows.length}), importing from row ${start + 1}`);
  }

  const toImport = limit ? sliced.slice(0, limit) : sliced;

  console.log(`Importing ${toImport.length} messages into ${mailboxEmail}...`);

  // Resolve JMAP credentials from environment
  const jmapWellKnown = jmapWellKnownSessionUrl(process.env);
  if (!jmapWellKnown) {
    console.error("Error: Set JMAP_URL to your mail server base URL (e.g. https://mail.example.org).");
    process.exit(1);
  }

  const baseUrl = process.env.JMAP_URL || jmapWellKnown.replace(/\/\.well-known\/jmap\/?$/, "");
  const serviceAccountEmail = (process.env.JMAP_SERVICE_ACCOUNT_EMAIL || "").trim();
  const serviceAccountPassword = (process.env.JMAP_SERVICE_ACCOUNT_PASSWORD || "").trim();

  if (!serviceAccountEmail || !serviceAccountPassword) {
    console.error("Error: JMAP_SERVICE_ACCOUNT_EMAIL and JMAP_SERVICE_ACCOUNT_PASSWORD must be set");
    process.exit(1);
  }

  const client = new JmapClient({
    baseUrl,
    login: serviceAccountEmail,
    password: serviceAccountPassword,
    impersonate: mailboxEmail,
  });

  // Discover session and get account ID
  const session = await (client as any)._discoverSession();
  const accountId = client.getAccountId(session);
  console.log(`Account ID: ${accountId}`);

  // Find the inbox mailbox
  const inbox = await client.getMailbox("inbox");
  if (!inbox) {
    console.error("Error: Could not find inbox mailbox");
    process.exit(1);
  }
  const inboxId = inbox.id;
  console.log(`Inbox mailbox ID: ${inboxId}`);

  let imported = 0;
  let failed = 0;

  /**
   * Make a JMAP request, retrying up to 5 times on 429 rate-limit responses
   * with a 1-second delay between attempts.
   */
  async function requestWithRetry(
    client: any,
    url: string,
    options: { method: string; headers: Record<string, string>; body: string },
    retries = 5,
  ): Promise<any> {
    for (let attempt = 1; ; attempt++) {
      try {
        const result = await (client as any)._requestJson(url, options);
        if (result?.status === 429) {
          console.log("waiting ...");
          await new Promise((r) => setTimeout(r, 1000));
          continue;
        }
        return result;
      } catch (err: any) {
        const isRateLimit =
          err?.status === 429 ||
          err?.cause?.status === 429 ||
          (typeof err === "object" && err?.type === "about:blank" && err?.status === 429);

        if (isRateLimit && attempt < retries) {
          console.log(`  Rate limited (attempt ${attempt}/${retries}), waiting 1s before retry…`);
          await new Promise((r) => setTimeout(r, 1000));
          continue;
        }
        throw err;
      }
    }
  }

  for (let i = 0; i < toImport.length; i++) {
    const row = toImport[i];
    const senderName = `${row.first_name} ${row.last_name}`.trim();
    const receivedAt = row.created_at
      ? new Date(row.created_at).toISOString()
      : new Date().toISOString();

    // Strip template placeholders from the body text
    const bodyText = row.msg_body.replace(/\{\{target\.fields\.salutation\}\},\s*\n/g, "").trim();

    // Safe mode: check if a message from this sender already exists nearby
    if (safe) {
      const rowTime = new Date(row.created_at).getTime();
      const windowMs = 60 * 60 * 1000; // ±1 hour
      const after = new Date(rowTime - windowMs).toISOString();
      const before = new Date(rowTime + windowMs).toISOString();

      const queryJson = await requestWithRetry(client, session.apiUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          using: ["urn:ietf:params:jmap:core", "urn:ietf:params:jmap:mail"],
          methodCalls: [
            [
              "Email/query",
              {
                accountId,
                filter: {
                  from: row.email,
                  after,
                  before,
                },
                limit: 1,
              },
              "c0",
            ],
          ],
        }),
      });

      const ids = queryJson.methodResponses?.[0]?.[1]?.ids;
      if (ids && ids.length > 0) {
        console.log(`  Row ${i + 1}: Skipped (duplicate from ${row.email} near ${row.created_at})`);
        continue;
      }
    }

    try {
      const json = await requestWithRetry(client, session.apiUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          using: ["urn:ietf:params:jmap:core", "urn:ietf:params:jmap:mail"],
          methodCalls: [
            [
              "Email/set",
              {
                accountId,
                create: {
                  [`msg-${i}`]: {
                    mailboxIds: { [inboxId]: true },
                    receivedAt,
                    from: [{ name: senderName, email: row.email }],
                    to: [{ name: row.target_name || "", email: mailboxEmail }],
                    subject: row.msg_subject,
                    textBody: [{ partId: "p1", type: "text/plain" }],
                    bodyValues: { p1: { value: bodyText } },
                  },
                },
              },
              "c1",
            ],
          ],
        }),
      });

      const created = json.methodResponses?.[0]?.[1]?.created?.[`msg-${i}`];
      if (created) {
        imported++;
        if (imported % 10 === 0 || imported === toImport.length) {
          console.log(`Progress: ${imported}/${toImport.length} imported`);
        }
      } else {
        const notCreated =
          json.methodResponses?.[0]?.[1]?.notCreated?.[`msg-${i}`];
        console.error(
          `Row ${i + 1}: Failed to import - ${JSON.stringify(notCreated)}`,
        );
        console.log (json); process.exit(1);
        failed++;
      }
    } catch (err) {
      console.error(`Row ${i + 1}: Error - ${err}`);
      failed++;
    }
  }

  console.log(
    `Done. Imported: ${imported}, Failed: ${failed}, Total: ${toImport.length}`,
  );

  if (failed > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
