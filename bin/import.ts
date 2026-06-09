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
}

function parseArgs(): ImportArgs {
  const argv = minimist(process.argv.slice(2), {
    string: ["limit"],
    boolean: ["help"],
    alias: { h: "help" },
    unknown: (d: string) => {
      if (d[0] !== "-") return true;
      console.error(`Unknown option: ${d}`);
      process.exit(1);
      return false;
    },
  });

  if (argv.help) {
    console.error(
      "Usage: npx tsx bin/import.ts <mailbox-email> <csv-file> [--limit N]",
    );
    process.exit(1);
  }

  const positional = argv._;
  const mailboxEmail: string | undefined = positional[0];
  const csvFile: string | undefined = positional[1];

  if (!mailboxEmail || !csvFile) {
    console.error(
      "Usage: npx tsx bin/import.ts <mailbox-email> <csv-file> [--limit N]",
    );
    process.exit(1);
  }

  const limit = argv.limit !== undefined ? Number(argv.limit) : null;
  if (limit !== null && (isNaN(limit) || limit < 1)) {
    console.error("Error: --limit must be a positive integer");
    process.exit(1);
  }

  return { mailboxEmail, csvFile, limit };
}

async function main() {
  const { mailboxEmail, csvFile, limit } = parseArgs();

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

  const toImport = limit ? rows.slice(0, limit) : rows;

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

  for (let i = 0; i < toImport.length; i++) {
    const row = toImport[i];
    const senderName = `${row.first_name} ${row.last_name}`.trim();
    const receivedAt = row.created_at
      ? new Date(row.created_at).toISOString()
      : new Date().toISOString();

    // Strip template placeholders from the body text
    const bodyText = row.msg_body.replace(/\{\{target\.fields\.salutation\}\},\s*\n/g, "").trim();

    try {
      const json = await (client as any)._requestJson(session.apiUrl, {
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
