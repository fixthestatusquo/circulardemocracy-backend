#!/usr/bin/env -S ./node_modules/.bin/tsx

import minimist from "minimist";
import { createClient } from "@supabase/supabase-js";
import { config as dotenv } from "dotenv";

dotenv();

async function main() {
  const argv = minimist(process.argv.slice(2), {
    string: [
      "email",
      "name",
      "country",
      "region",
      "level",
      "position",
      "party",
    ],
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
Usage: add-politician --email <email> --name <name> [options]

Options:
  --email <email>       Required. Politician's email address
  --name <name>         Politician's full name (default: derived from email
                        when in first.last@domain format)
  --country <ISO2>      Country code (e.g. US, FR)
  --region <region>     Region (e.g. CA-12)
  --level <level>       Government level (e.g. local, state, federal)
  --position <position> Political position (e.g. Mayor, Senator)
  --party <party>       Political party
  -h, --help            Show this help message

The script also looks up an existing user with the same email in the auth
system and grants them staff access to this politician (politician_staff row).
Requires SUPABASE_SERVICE_ROLE_KEY for the staff lookup.
`);
    return;
  }

  const { email, name, country, region, level, position, party } = argv;

  if (!email) {
    console.error("Error: --email is required");
    process.exit(1);
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_KEY;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    console.error("Error: SUPABASE_URL and SUPABASE_KEY must be set");
    process.exit(1);
  }

  // Use service role key for admin operations if available
  const adminClient = serviceRoleKey
    ? createClient(supabaseUrl, serviceRoleKey, {
        auth: { autoRefreshToken: false, persistSession: false },
      })
    : null;

  const client = createClient(supabaseUrl, supabaseKey);

  // Derive name from email if not provided (first.last@domain → First Last)
  const derivedName =
    name ||
    email
      .split("@")[0]
      .split(".")
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" ") ||
    email;

  try {
    // Step 1: Create the politician
    const insertData: Record<string, unknown> = {
      email,
      name: derivedName,
      active: true,
      country: country || null,
      region: region || null,
      level: level || null,
      position: position || null,
      party: party || null,
    };

    let politician: Record<string, unknown> | null = null;

    console.log(`💾 Creating politician: ${derivedName} <${email}>`);
    const { data: created, error: createError } = await client
      .from("politicians")
      .insert(insertData)
      .select()
      .single();

    if (createError) {
      if (createError.message.includes("duplicate key") || createError.code === "23505") {
        console.log(`ℹ️  Politician with email ${email} already exists, fetching...`);
        const { data: existing } = await client
          .from("politicians")
          .select()
          .eq("email", email)
          .single();
        if (!existing) {
          console.error(`❌ Politician with email ${email} not found after duplicate error`);
          process.exit(1);
        }
        politician = existing;
        console.log(`📎 Using existing politician (id: ${politician.id})`);
      } else {
        console.error(`❌ Error creating politician: ${createError.message}`);
        process.exit(1);
      }
    } else {
      politician = created;
      console.log(`✅ Politician created (id: ${politician.id})`);
    }

    console.log(JSON.stringify(politician, null, 2));

    // Step 2: Grant staff access to user with same email
    if (!adminClient) {
      console.log(
        "\n⚠️  SUPABASE_SERVICE_ROLE_KEY not set — skipping staff access grant.\n" +
          "   Set it and re-run, or manually insert a row in politician_staff:\n" +
          `   INSERT INTO politician_staff (user_id, politician_id, role)\n` +
          `   VALUES ('<auth-user-uuid>', ${politician.id}, 'staff');`,
      );
      return;
    }

    console.log(`\n🔍 Looking up auth user by email: ${email}`);
    const { data: authUsers, error: listError } =
      await adminClient.auth.admin.listUsers();

    if (listError) {
      console.error(`❌ Failed to list auth users: ${listError.message}`);
      process.exit(1);
    }

    const matchedUser = authUsers?.users?.find(
      (u) => u.email?.toLowerCase() === email.toLowerCase(),
    );

    if (!matchedUser) {
      console.log(
        `ℹ️  No auth user found with email ${email}. Staff access not granted.`,
      );
      return;
    }

    const userId = matchedUser.id;
    console.log(`✅ Found user: ${matchedUser.email} (${userId})`);

    const { error: staffError } = await client.from("politician_staff").insert({
      user_id: userId,
      politician_id: politician.id,
      role: "staff",
    });

    if (staffError) {
      console.error(`❌ Error granting staff access: ${staffError.message}`);
      process.exit(1);
    }

    console.log(
      `✅ Staff access granted for ${matchedUser.email} on politician ${politician.id}`,
    );
  } catch (error) {
    console.error(
      "❌ Failed:",
      error instanceof Error ? error.message : String(error),
    );
    process.exit(1);
  }
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
