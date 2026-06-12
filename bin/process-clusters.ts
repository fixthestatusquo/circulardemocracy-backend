#!/usr/bin/env -S ./node_modules/.bin/tsx

/**
 * Process pending cluster assignments.
 *
 * Finds clusters with status = 'ready' and campaign_id set, then:
 *  1. Snapshots the campaign's current reference_vector
 *  2. Assigns all messages in the cluster to the campaign
 *  3. Recalculates the campaign centroid from all its messages
 *  4. Marks the cluster as 'assigned'
 *
 * Usage: npx tsx bin/process-clusters.ts [--dry-run]
 */

import minimist from "minimist";
import { config as dotenv } from "dotenv";
import { DatabaseClient } from "../src/database.js";

dotenv();

async function main() {
  const argv = minimist(process.argv.slice(2), {
    boolean: ["dry-run", "help"],
    alias: { h: "help" },
    unknown: (d: string) => {
      if (d[0] !== "-") return true;
      console.error(`Unknown option: ${d}`);
      process.exit(1);
    },
  });

  if (argv.help) {
    console.log(`
Usage: process-clusters [--dry-run]

Processes all clusters with status = 'ready' and campaign_id set:
  - Snapshots the campaign vector before updating
  - Assigns cluster messages to the campaign
  - Recalculates campaign centroid
  - Marks cluster as 'assigned'

Options:
  --dry-run    Show what would be processed without making changes
  -h, --help   Show this help message
`);
    return;
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    console.error("Error: SUPABASE_URL and SUPABASE_KEY must be set");
    process.exit(1);
  }

  const db = new DatabaseClient({ url: supabaseUrl, key: supabaseKey });
  const supabase = (db as any).supabase;
  const dryRun = argv["dry-run"] === true;

  // 1. Find ready clusters with campaign_id assigned
  const { data: clusters, error: fetchError } = await supabase
    .from("message_clusters")
    .select("*")
    .eq("status", "ready")
    .not("campaign_id", "is", null);

  if (fetchError) {
    console.error(`❌ Error fetching clusters: ${fetchError.message}`);
    process.exit(1);
  }

  if (!clusters || clusters.length === 0) {
    console.log("No pending cluster assignments to process.");
    return;
  }

  console.log(`Found ${clusters.length} cluster(s) to process.\n`);

  let processed = 0;
  let errors = 0;

  for (const cluster of clusters) {
    console.log(
      `\n📦 Cluster ${cluster.id} (${cluster.message_count ?? "?"} messages) → campaign ${cluster.campaign_id}`,
    );

    try {
      // 1a. Snapshot the campaign's current reference_vector
      const { data: campaign } = await supabase
        .from("campaigns")
        .select("reference_vector")
        .eq("id", cluster.campaign_id)
        .single();

      const currentVector = campaign?.reference_vector;

      let snapshotId: number | null = null;

      if (!dryRun) {
        if (currentVector) {
          const vectorStr = Array.isArray(currentVector)
            ? `[${currentVector.join(",")}]`
            : currentVector;

          const { data: snapshot } = await supabase
            .from("message_clusters")
            .insert({
              centroid_vector: vectorStr,
              message_count: null,
              status: "snapshot",
              campaign_id: cluster.campaign_id,
            })
            .select("id")
            .single();

          snapshotId = snapshot?.id ?? null;
          console.log(`  📸 Campaign vector snapshotted (id: ${snapshotId})`);
        } else {
          console.log(`  📝 No existing campaign vector to snapshot`);
        }

        // 1b. Assign cluster messages to the campaign
        const { error: assignError } = await supabase
          .from("messages")
          .update({ campaign_id: cluster.campaign_id })
          .eq("cluster_id", cluster.id);

        if (assignError) {
          console.error(`  ❌ Error assigning cluster messages: ${assignError.message}`);
          errors++;
          continue;
        }
        console.log(`  ✅ ${cluster.message_count ?? 0} cluster messages → campaign ${cluster.campaign_id}`);

        // 1c. Link existing campaign messages to the snapshot (distance reference)
        if (snapshotId) {
          const { error: linkError } = await supabase
            .from("messages")
            .update({ cluster_id: snapshotId })
            .eq("campaign_id", cluster.campaign_id)
            .is("cluster_id", null);

          if (linkError) {
            console.warn(`  ⚠️  Failed to link messages to snapshot: ${linkError.message}`);
          } else {
            console.log(`  🔗 Existing campaign messages linked to snapshot ${snapshotId}`);
          }
        }
      } else {
        console.log(`  📸 Would snapshot campaign vector: ${currentVector ? "(present)" : "(none)"}`);
        console.log(`  ✅ Would assign ${cluster.message_count ?? "?"} messages to campaign ${cluster.campaign_id}`);
      }

      // 2. Recalculate campaign centroid from all messages under the campaign
      const { data: messages, error: msgError } = await supabase
        .from("messages")
        .select("message_embedding")
        .eq("campaign_id", cluster.campaign_id)
        .not("message_embedding", "is", null);

      if (msgError) {
        console.error(`  ❌ Error fetching messages for centroid: ${msgError.message}`);
        errors++;
        continue;
      }

      const embeddings = (messages || [])
        .map((m: { message_embedding: unknown }) => {
          const emb = m.message_embedding;
          if (typeof emb === "string") {
            try {
              return JSON.parse(emb);
            } catch {
              return null;
            }
          }
          return emb;
        })
        .filter((emb: unknown): emb is number[] => Array.isArray(emb) && emb.length > 0);

      if (embeddings.length === 0) {
        console.log(`  ⚠️  No embeddings found for campaign ${cluster.campaign_id}, skipping centroid update`);
      } else {
        const centroid = db.calculateCentroid(embeddings);

        if (!dryRun && centroid) {
          const centroidStr = `[${centroid.join(",")}]`;
          const { error: updateError } = await supabase
            .from("campaigns")
            .update({ reference_vector: centroidStr })
            .eq("id", cluster.campaign_id);

          if (updateError) {
            console.error(`  ❌ Error updating campaign vector: ${updateError.message}`);
            errors++;
            continue;
          }
          console.log(`  🧬 Campaign centroid recalculated (${embeddings.length} embeddings)`);
        } else if (dryRun && centroid) {
          console.log(`  🧬 Would recalculate campaign centroid (${embeddings.length} embeddings)`);
        } else {
          console.log(`  ⚠️  Could not calculate centroid`);
        }
      }

      // 3. Mark cluster as assigned
      if (!dryRun) {
        const { error: statusError } = await supabase
          .from("message_clusters")
          .update({ status: "assigned" })
          .eq("id", cluster.id);

        if (statusError) {
          console.error(`  ❌ Error updating cluster status: ${statusError.message}`);
          errors++;
          continue;
        }
        console.log(`  ✅ Cluster ${cluster.id} marked as 'assigned'`);
      } else {
        console.log(`  ✅ Would mark cluster ${cluster.id} as 'assigned'`);
      }

      processed++;
    } catch (err) {
      console.error(`  ❌ Unexpected error: ${err}`);
      errors++;
    }
  }

  console.log(`\n📊 Done: ${processed} processed, ${errors} errors`);
  process.exit(errors > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
