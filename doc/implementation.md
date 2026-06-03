# Circular Democracy — Email Ingestion Pipeline

This document describes the architecture of `bin/fetch.ts` and its relationship with `src/message_processor.ts` and `src/database.ts`. It covers the **batch-optimised** version implemented to minimise round-trips to Supabase/PostgreSQL.

---

## Big-picture flow

```
┌─────────────────────────────────────────────────────────────────────┐
│  bin/fetch.ts                                                       │
│                                                                     │
│  ┌──────────┐    ┌───────────────┐    ┌────────────────────────┐   │
│  │  JMAP    │    │  Convert to   │    │  Deduplicate against   │   │
│  │  fetch   │───▶│  MessageInput │───▶│  already-processed IDs │   │
│  │  emails  │    │  (+ validate) │    │  (1 Supabase query)    │   │
│  └──────────┘    └───────────────┘    └───────────┬────────────┘   │
│                                                    │                │
│                                    ┌───────────────┘                │
│                                    ▼                                │
│                          ┌──────────────────┐                       │
│                          │  processMessage   │  ◀── single call     │
│                          │  Batch            │  (src/message_       │
│                          │  (N messages)     │   processor.ts)      │
│                          └────────┬─────────┘                       │
│                                   │                                 │
│                                   ▼                                 │
│                          ┌──────────────────┐                       │
│                          │  JMAP folder     │  per-message          │
│                          │  moves           │  (external server)    │
│                          └──────────────────┘                       │
└─────────────────────────────────────────────────────────────────────┘
```

The pipeline ingests emails from a Stalwart JMAP server, generates embeddings, classifies each message against existing campaigns, clusters them by topic, computes duplicate ranks, upserts supporters, and schedules auto-replies — all in a single batch pass.

---

## The three layers

### 1. `bin/fetch.ts` — orchestration

- Resolves the JMAP session, account ID, and inbox folder.
- Fetches emails in pages of 50 via JMAP `Email/query` + `Email/get`.
- Runs a single `getAlreadyProcessedExternalIds` query to filter out messages already in the database.
- Converts raw JMAP email objects into validated `MessageInput` structs.
- Calls `processMessageBatch(db, ai, messages)` **once** for the entire batch.
- For each result, moves the source email to a folder named after the assigned campaign (JMAP `Email/set` with `mailboxIds`).
- Prints a summary: processed / duplicates / politician-not-found / failed / moved.

### 2. `src/message_processor.ts` — batch pipeline

The new `processMessageBatch` function runs the following steps in order:

| Step | Description | DB calls |
|------|-------------|----------|
| 0 | Resolve the politician (all messages share one recipient) | 1 |
| 1 | Generate embeddings (`@xenova/transformers` / `@cf/baai/bge-m3`) + SHA-256 sender hashes | 0 |
| 2 | Insert each message row into `messages` | **N** [^1] |
| 3 | `batchClassifyMessages` — classify all messages against campaigns | 1–2 |
| 4 | `batchUpdateMessageFields` — store `campaign_id` + `confidence` | 1–3 groups |
| 5 | `batchAssignToClusters` — assign unclassified messages to topic clusters | 1 lock + ~4 |
| 6 | `batchGetDuplicateRanks` — compute duplicate rank for every classified message | 1 |
| 7 | `batchUpsertSupporters` — create/update supporter rows | 1 |
| 8 | Apply reply scheduling (with cached template lookups) | N [^2] |

[^1]: Individual INSERTs are required because Supabase's JS client does not support `INSERT ... RETURNING id` for arrays, and the returned IDs are needed for subsequent steps. A future bulk-insert RPC could collapse these into one call.

[^2]: Reply scheduling queries `messages` (for scheduling metadata) and `reply_templates` (for send timing). Template results are cached in a `Map<string, ReplyTemplate>` so each unique `(campaignId, politicianId)` pair is fetched once.

### 3. `src/database.ts` — batch database methods

Five new batch methods were added to `DatabaseClient`:

#### `batchClassifyMessages(entries)`

- Collects all unique `campaignHint` strings and fetches matching campaigns in **one** query.
- For entries without a hint match, runs `findSimilarCampaigns` (pgvector `<=>` RPC) **concurrently** via `Promise.all`.
- Returns a `ClassificationResult[]` aligned to the input array.

#### `batchAssignToClusters(messageIds, embeddings, politicianId)`

- Acquires the global advisory lock **once**.
- Phase 1: For each embedding, calls `findSimilarClusters` to match existing clusters.
- Phase 2: For orphan messages (no cluster match), calls `findSimilarMessages` globally and also checks **intra-batch similarity** (cosine distance against other orphans in the same batch). This compensates for the serial dependency that the original per-message code had — two similar messages in the same batch will still end up in the same cluster.
- Phase 3: Bulk UPDATEs all `messages.cluster_id` assignments.
- Phase 4: Calls `updateClusterCentroid` and `checkClusterReadiness` once per affected cluster.
- Releases the lock in `finally`.

#### `batchGetDuplicateRanks(entries)`

- Fetches `sender_hash` + `campaign_id` from `messages` with `IN` filters on both columns.
- Counts occurrences in-memory and returns a `Map<key, rank>`.

#### `batchUpsertSupporters(entries)`

- Builds an array of supporter rows and passes it to Supabase's `upsert()` in a single call.

#### `batchUpdateMessageFields(updates)`

- Groups individual row updates by identical field sets.
- Runs each group as a single `UPDATE ... WHERE id IN (...)` call via `Promise.all`.

---

## Request-count comparison

For a batch of **50 messages**:

| Operation | Per-message (before) | Batch (after) |
|-----------|---------------------|---------------|
| Politician lookup | 50 | **1** |
| Duplicate check (`getMessageByExternalId`) | 50 | **0** (pre-filtered) |
| Campaign hint lookup | ≤50 | **1** |
| `findSimilarCampaigns` RPC | 50 | 50 (concurrent) |
| Classification field update | 50 | **1–3 groups** |
| Advisory lock acquire/release | 50 | **1** |
| `findSimilarClusters` RPC | 50 | 50 (in lock) |
| `findSimilarMessages` RPC | ≤50 | ≤50 (in lock) |
| Cluster centroid update | 50 | **≤#new-clusters** |
| Cluster readiness check | 50 | **≤#new-clusters** |
| `getDuplicateRank` | 50 | **1** |
| Duplicate rank update | 50 | **1 group** |
| `upsertSupporter` | 50 | **1** |
| `getMessageForReplyScheduling` | 50 | 50 |
| `getActiveTemplateForCampaign` | 50 | **≤#unique-campaigns** |
| Reply schedule update | 50 | 50 |
| **Total Supabase calls** | **~900** | **~80** |

---

## Intra-batch clustering

The original per-message `assignMessageToCluster` had an implicit serial dependency: message 2 could join a cluster created by message 1. When processing a batch under a single lock, newly-created clusters don't exist yet for other messages in the same batch.

To handle this, `batchAssignToClusters` adds a **phase 2 intra-batch check**: after all messages have tried to match existing clusters, remaining orphans are compared against each other using `_cosineDistance`. If two or more orphans are close (< 0.1 distance), they are grouped into a new cluster together — exactly matching the behaviour the serial code would have produced.

This is a pure in-memory computation (no DB calls), so it adds negligible latency.

---

## `createCliCompatibleDb`

The function in `bin/fetch.ts` wraps the `DatabaseClient` instance via `Object.create(db)` and overrides three methods:

- **`classifyMessage`** — replaces the DB implementation with the CLI-specific one (uses `findSimilarCampaigns` with distance threshold < 0.1, returns `campaign_slug` instead of `campaign_name`).
- **`classifyAndAssignToCluster`** — wraps `classifyMessage` + `updateMessageFields` + conditionally calls `assignMessageToCluster` only for unclassified messages.
- **`insertMessage`** — adds a fallback path for missing `is_reply`/`sender_flag` columns (schema migration compatibility).

The new batch methods exist on `DatabaseClient.prototype` and are inherited through the prototype chain (`compatibleDb → raw db → DatabaseClient.prototype`), so they are accessible without changes to `createCliCompatibleDb`.

---

## What the batch pipeline does NOT change

- **JMAP interactions** — fetching emails and moving them to folders are still per-page / per-message. These are external server calls, not database calls.
- **Embedding generation** — embeddings are generated one-at-a-time because the ONNX runtime (`@xenova/transformers`) is not thread-safe for concurrent inference.
- **Individual message INSERT** — each message is inserted separately. A future optimisation could use a PostgreSQL function that accepts `jsonb` and returns `int[]`.
- **Reply scheduling metadata** — `getMessageForReplyScheduling` and the subsequent `updateMessageFields` for `reply_scheduled_at` are still per-message. These only run for messages that have a campaign assigned and `duplicate_rank === 0`, so the actual count is typically lower than the full batch size.

---

## Future work

- **Bulk INSERT RPC**: A PostgreSQL function `insert_messages(jsonb[]) RETURNS TABLE(id int)` would collapse N INSERTs into one call.
- **Batch vector RPCs**: `batch_find_similar_campaigns(vector(1024)[]), ` `batch_find_similar_clusters(vector(1024)[])`, and `batch_find_similar_messages(vector(1024)[])` using `unnest` + lateral joins would reduce the RPC calls inside the lock from 2N to 2.
- **Full PL/pgSQL pipeline**: Move the entire classification + clustering + ranking logic into a PostgreSQL function that accepts a `jsonb` array and returns results in a single round-trip. Trade-off: TypeScript is easier to maintain and test than PL/pgSQL.
- **Remove debug artifacts**: The two `process.exit(1)` calls in `processMessage` (lines 122 and 182) are debug leftovers that cause the function to abort after the first classification. They are bypassed by the new batch path but should be removed from the per-message path as well.
