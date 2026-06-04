import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/supabase";

// Database Layer - Supabase REST API Client
// Handles all database operations for Circular Democracy

interface SupabaseConfig {
  url: string;
  key: string;
  accessToken?: string;
}

export interface Politician {
  id: number;
  name: string;
  email: string;
  reply_to?: string | null;
  additional_emails: string[];
  active: boolean;
}

export interface Campaign {
  id: number;
  name: string;
  slug: string;
  status: string;
  technical_email?: string | null;
  reply_to_email?: string | null;
  reference_vector?: number[];
}

export interface MessageInsert {
  external_id: string;
  channel: string;
  channel_source: string;
  politician_id: number;
  sender_hash: string;
  campaign_id: number;
  classification_confidence: number;
  message_embedding: number[];
  language: string;
  received_at: string;
  duplicate_rank: number;
  processing_status: string;
  reply_scheduled_at?: string | null;
  sender_flag?: string;
  stalwart_message_id?: string;
  stalwart_account_id?: string;
}

export interface ReplyTemplate {
  id: number;
  campaign_id: number;
  politician_id: number;
  name: string;
  subject: string;
  body: string;
  active: boolean;
  layout_type: "text_only" | "standard_header" | "EP";
  send_timing: "immediate" | "office_hours" | "scheduled";
  scheduled_for?: string | null;
  created_at: string;
  updated_at: string;
}

export interface ClassificationResult {
  campaign_id: number | null;
  campaign_slug: string | null;
  confidence: number;
}

export class DatabaseClient {
  public supabase: SupabaseClient;

  constructor(config: SupabaseConfig) {
    const headers: Record<string, string> = {};
    if (config.accessToken) {
      headers.Authorization = `Bearer ${config.accessToken}`;
    }
    this.supabase = createClient<Database>(config.url, config.key, {
      auth: {
        persistSession: false,
      },
      // Keep explicit fetch for Worker/Node parity.
      // Authorization header above scopes this client to the caller JWT.
      global: {
        fetch: (...args) => fetch(...args),
        headers,
      },
    });
  }

  async request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    const [rawTable, rawQuery] = endpoint.split("?");
    const table = rawTable.replace(/^\//, "");
    const queryParams = new URLSearchParams(rawQuery || "");
    const method = (options.method || "GET").toUpperCase();
    const body = options.body ? JSON.parse(options.body.toString()) : undefined;

    try {
      if (method === "GET") {
        let query: any = this.supabase
          .from(table)
          .select(queryParams.get("select") || "*");

        for (const [key, value] of queryParams.entries()) {
          if (key === "select" || key === "limit") {
            continue;
          }

          const [operator, ...rest] = value.split(".");
          const filterValue = rest.join(".");
          if (operator === "eq") {
            query = query.eq(key, filterValue);
          } else if (operator === "in") {
            const list = filterValue
              .replace(/^\(/, "")
              .replace(/\)$/, "")
              .split(",")
              .map((item) => item.trim())
              .filter((item) => item.length > 0);
            query = query.in(key, list);
          }
        }

        if (queryParams.get("limit")) {
          query = query.limit(
            Number.parseInt(queryParams.get("limit") || "0", 10),
          );
        }

        const { data, error } = await query;
        if (error) {
          throw new Error(`Database error: ${error.message}`);
        }
        return data as T;
      }

      if (method === "POST") {
        const { data, error } = await this.supabase
          .from(table)
          .insert(body)
          .select();
        if (error) {
          throw new Error(`Database error: ${error.message}`);
        }
        return data as T;
      }

      if (method === "PATCH") {
        const id = queryParams.get("id");
        if (!id?.startsWith("eq.")) {
          throw new Error("PATCH requests require id=eq.<value> in endpoint");
        }
        const patchId = id.replace("eq.", "");
        const { data, error } = await this.supabase
          .from(table)
          .update(body)
          .eq("id", patchId)
          .select();
        if (error) {
          throw new Error(`Database error: ${error.message}`);
        }
        return data as T;
      }

      if (method === "DELETE") {
        const id = queryParams.get("id");
        if (!id?.startsWith("eq.")) {
          throw new Error("DELETE requests require id=eq.<value> in endpoint");
        }
        const deleteId = id.replace("eq.", "");
        const { error } = await this.supabase
          .from(table)
          .delete()
          .eq("id", deleteId);
        if (error) {
          throw new Error(`Database error: ${error.message}`);
        }
        return [] as T;
      }

      throw new Error(`Unsupported request method: ${method}`);
    } catch (error) {
      throw error instanceof Error
        ? error
        : new Error("Unknown database request error");
    }
  }

  // =============================================================================
  // POLITICIAN OPERATIONS
  // =============================================================================

  async findPoliticianByEmail(email: string): Promise<Politician | null> {
    try {
      // First try exact email match
      const { data: exactMatch, error: exactError } = await this.supabase
        .from("politicians")
        .select("id,name,email,reply_to,additional_emails,active")
        .eq("email", email)
        .eq("active", true);

      if (exactError) {
        throw exactError;
      }
      if (exactMatch && exactMatch.length > 0) {
        return exactMatch[0];
      }

      // Then try additional_emails array search
      const { data: arrayMatch, error: arrayError } = await this.supabase
        .from("politicians")
        .select("id,name,email,reply_to,additional_emails,active")
        .contains("additional_emails", [email])
        .eq("active", true);

      if (arrayError) {
        throw arrayError;
      }
      return arrayMatch && arrayMatch.length > 0 ? arrayMatch[0] : null;
    } catch (error) {
      console.error("Error finding politician:", error);
      return null;
    }
  }

  /**
   * Mailbox addresses on {@link domain} used for multi-mailbox Stalwart ingestion
   * (active politicians + campaign technical addresses).
   */
  async listStalwartMailboxAddressesForDomain(
    domain: string,
  ): Promise<string[]> {
    const d = domain.trim().toLowerCase().replace(/^@/, "");
    if (!d) {
      return [];
    }

    const { data: rows, error } = await this.supabase
      .from("stalwart_mailbox_addresses")
      .select("mailbox_address")
      .eq("email_domain", d);

    if (error) {
      throw error;
    }

    return (rows || [])
      .map((row) => String(row.mailbox_address).trim())
      .filter(Boolean)
      .sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
  }

  // =============================================================================
  // CAMPAIGN OPERATIONS
  // =============================================================================

  async findCampaignByHint(hint: string): Promise<Campaign | null> {
    try {
      const { data: campaigns, error } = await this.supabase
        .from("campaigns")
        .select("id,name,slug,status,reference_vector")
        .or(`name.ilike.*${hint}*,slug.ilike.*${hint}*`)
        .in("status", ["active", "unconfirmed"])
        .limit(1);

      if (error) {
        throw error;
      }
      return campaigns.length > 0 ? campaigns[0] : null;
    } catch (error) {
      console.error("Error finding campaign by hint:", error);
      return null;
    }
  }

  async findSimilarCampaigns(
    embedding: number[],
    limit = 3,
  ): Promise<Array<Campaign & { distance: number }>> {
    try {
      const { data, error } = await this.supabase.rpc(
        "find_similar_campaigns",
        {
          query_embedding: embedding,
          distance_threshold: 0.1,
          match_limit: limit,
        },
      );

      if (error) {
        throw error;
      }
      return data;
    } catch (error) {
      console.error("Error finding similar campaigns:", error);

      // Fallback: get all active campaigns without distance calculation
      const { data: fallback, error: fallbackError } = await this.supabase
        .from("campaigns")
        .select("id,name,slug,status")
        .in("status", ["active", "unconfirmed"])
        .not("reference_vector", "is", null)
        .limit(limit);

      if (fallbackError) {
        throw fallbackError;
      }
      return fallback.map((camp) => ({ ...camp, distance: 0.1 }));
    }
  }

  // =============================================================================
  // MESSAGE CLUSTERING
  // =============================================================================

  private static readonly MIN_CLUSTER_SIZE_FOR_CAMPAIGN = 2;

  private async acquireGlobalClusteringLock(): Promise<boolean> {
    try {
      const { data, error } = await this.supabase.rpc(
        "acquire_global_clustering_lock",
      );

      if (error) {
        console.error("Error acquiring advisory lock:", error);
        return false;
      }

      return data === true;
    } catch (error) {
      console.error("Exception acquiring advisory lock:", error);
      return false;
    }
  }

  private async releaseGlobalClusteringLock(): Promise<void> {
    try {
      await this.supabase.rpc("release_global_clustering_lock");
    } catch (error) {
      console.error("Error releasing advisory lock:", error);
    }
  }

  async findSimilarMessages(
    embedding: number[],
    limit = 10,
  ): Promise<
    Array<{
      id: number;
      distance: number;
      campaign_id: number | null;
      cluster_id: number | null;
      politician_id: number;
    }>
  > {
    try {
      const { data, error } = await this.supabase.rpc(
        "find_similar_messages_global",
        {
          query_embedding: embedding,
          distance_threshold: 0.1,
          match_limit: limit,
        },
      );

      if (error) {
        console.error("RPC error:", error);
        throw error;
      }

      if (data && data.length > 0) {
        console.log(
          `  🔍 RPC returned ${data.length} messages, distances: ${data
            .slice(0, 3)
            .map((m: any) => m.distance?.toFixed(4))
            .join(", ")}`,
        );
      }

      return data || [];
    } catch (error) {
      console.error("Error finding similar messages:", error);
      return [];
    }
  }

  async findSimilarClusters(
    embedding: number[],
    limit = 10,
  ): Promise<
    Array<{ clusterId: number; distance: number; messageCount: number }>
  > {
    try {
      const { data, error } = await this.supabase.rpc("find_similar_clusters", {
        query_embedding: embedding,
        distance_threshold: 0.1,
        match_limit: limit,
      });

      if (error) {
        console.error("RPC error finding similar clusters:", error);
        throw error;
      }

      return (data || []).map((cluster: any) => ({
        clusterId: cluster.id,
        distance: cluster.distance,
        messageCount: cluster.message_count,
      }));
    } catch (error) {
      console.error("Error finding similar clusters:", error);
      return [];
    }
  }

  async assignMessageToCluster(
    messageId: number,
    embedding: number[],
    politicianId: number,
  ): Promise<number | null> {
    const lockAcquired = await this.acquireGlobalClusteringLock();

    if (!lockAcquired) {
      console.log(`  ⏳ Could not acquire global clustering lock, retrying...`);
      await new Promise((resolve) => setTimeout(resolve, 100));
      return this.assignMessageToCluster(messageId, embedding, politicianId);
    }

    try {
      const similarClusters = await this.findSimilarClusters(embedding, 50);

      if (similarClusters.length > 0) {
        const selectedCluster = [...similarClusters].sort((a, b) => {
          if (b.messageCount !== a.messageCount) {
            return b.messageCount - a.messageCount;
          }
          return a.distance - b.distance;
        })[0];

        console.log(
          `  ✅ Joining existing cluster ${selectedCluster.clusterId} by centroid (distance: ${selectedCluster.distance.toFixed(4)}, size: ${selectedCluster.messageCount})`,
        );

        await this.supabase
          .from("messages")
          .update({ cluster_id: selectedCluster.clusterId })
          .eq("id", messageId);

        await this.updateClusterCentroid(selectedCluster.clusterId);
        await this.checkClusterReadiness(selectedCluster.clusterId);

        return selectedCluster.clusterId;
      }

      console.log(
        `  🔍 No similar clusters by centroid, checking similar unclustered messages`,
      );
      const similarMessages = await this.findSimilarMessages(embedding, 50);
      const closeMatches = similarMessages.filter(
        (m) => m.id !== messageId && m.distance < 0.1,
      );

      const existingClusterFromCloseMatches = closeMatches.find(
        (m) => m.cluster_id !== null,
      );

      if (existingClusterFromCloseMatches?.cluster_id) {
        const clusterId = existingClusterFromCloseMatches.cluster_id;
        console.log(
          `  ✅ Joining existing cluster ${clusterId} via fallback close-match logic`,
        );

        await this.supabase
          .from("messages")
          .update({ cluster_id: clusterId })
          .eq("id", messageId);

        const unclusteredSimilarMessageIds = closeMatches
          .filter((m) => m.cluster_id === null)
          .map((m) => m.id);

        if (unclusteredSimilarMessageIds.length > 0) {
          console.log(
            `  🔗 Also assigning ${unclusteredSimilarMessageIds.length} unclustered similar messages to cluster ${clusterId}`,
          );
          await this.supabase
            .from("messages")
            .update({ cluster_id: clusterId })
            .in("id", unclusteredSimilarMessageIds);
        }

        await this.updateClusterCentroid(clusterId);
        await this.checkClusterReadiness(clusterId);

        return clusterId;
      }

      const unclusteredSimilarMessages = closeMatches.filter(
        (m) => m.cluster_id === null,
      );

      if (unclusteredSimilarMessages.length > 0) {
        console.log(
          `  🆕 Creating cluster for ${unclusteredSimilarMessages.length + 1} similar unclustered messages`,
        );
        const { data: newCluster, error: createError } = await this.supabase
          .from("message_clusters")
          .insert({
            centroid_vector: `[${embedding.join(",")}]`,
            message_count: unclusteredSimilarMessages.length + 1,
            status: "forming",
          })
          .select("id")
          .single();

        if (createError || !newCluster) {
          console.error("Error creating cluster:", createError);
          return null;
        }

        const newClusterId = newCluster.id;
        const allMessageIds = [
          messageId,
          ...unclusteredSimilarMessages.map((m) => m.id),
        ];

        await this.supabase
          .from("messages")
          .update({ cluster_id: newClusterId })
          .in("id", allMessageIds);

        await this.updateClusterCentroid(newClusterId);
        await this.checkClusterReadiness(newClusterId);

        return newClusterId;
      }

      console.log(
        `  🆕 Creating isolated cluster (no similar clusters or messages)`,
      );
      const { data: newCluster, error: createError } = await this.supabase
        .from("message_clusters")
        .insert({
          centroid_vector: `[${embedding.join(",")}]`,
          message_count: 1,
          status: "forming",
        })
        .select("id")
        .single();

      if (createError || !newCluster) {
        console.error("Error creating cluster:", createError);
        return null;
      }

      await this.supabase
        .from("messages")
        .update({ cluster_id: newCluster.id })
        .eq("id", messageId);

      await this.checkClusterReadiness(newCluster.id);

      return newCluster.id;
    } catch (error) {
      console.error("Error in assignMessageToCluster:", error);
      return null;
    } finally {
      await this.releaseGlobalClusteringLock();
    }
  }

  async updateClusterCentroid(clusterId: number): Promise<void> {
    try {
      const { data: messages, error } = await this.supabase
        .from("messages")
        .select("message_embedding")
        .eq("cluster_id", clusterId)
        .not("message_embedding", "is", null);

      if (error || !messages || messages.length === 0) {
        return;
      }

      const embeddings = messages
        .map((m) => {
          const emb = m.message_embedding;
          // Handle both string and array formats
          if (typeof emb === "string") {
            try {
              return JSON.parse(emb);
            } catch {
              return null;
            }
          }
          return emb;
        })
        .filter((emb): emb is number[] => Array.isArray(emb) && emb.length > 0);

      const centroid = this.calculateCentroid(embeddings);

      if (centroid) {
        await this.supabase
          .from("message_clusters")
          .update({
            centroid_vector: `[${centroid.join(",")}]`,
            message_count: embeddings.length,
            updated_at: new Date().toISOString(),
          })
          .eq("id", clusterId);
      }
    } catch (error) {
      console.error(`Error updating cluster ${clusterId} centroid:`, error);
    }
  }

  async checkClusterReadiness(clusterId: number): Promise<void> {
    try {
      const { data: cluster } = await this.supabase
        .from("message_clusters")
        .select("message_count, status")
        .eq("id", clusterId)
        .single();

      if (
        cluster &&
        cluster.message_count >= DatabaseClient.MIN_CLUSTER_SIZE_FOR_CAMPAIGN &&
        cluster.status === "forming"
      ) {
        await this.supabase
          .from("message_clusters")
          .update({ status: "ready" })
          .eq("id", clusterId);
      }
    } catch (error) {
      console.error(`Error checking cluster ${clusterId} readiness:`, error);
    }
  }

  async assignCampaignToCluster(
    clusterId: number,
    campaignId: number,
  ): Promise<void> {
    try {
      console.log(`Assigning campaign ${campaignId} to cluster ${clusterId}`);

      // Update all messages in the cluster with the campaign ID
      const { data: updatedMessages, error: updateError } = await this.supabase
        .from("messages")
        .update({ campaign_id: campaignId })
        .eq("cluster_id", clusterId)
        .select("id");

      if (updateError) {
        throw updateError;
      }

      console.log(
        `Updated ${updatedMessages?.length || 0} messages in cluster ${clusterId} with campaign ${campaignId}`,
      );
    } catch (error) {
      console.error("Error assigning campaign to cluster:", error);
      throw error;
    }
  }

  async syncCampaignFromClusters(): Promise<number> {
    try {
      console.log("Syncing campaign IDs from clusters to messages...");

      // First, get all messages that have clusters but no campaign_id
      const { data: messagesToSync, error: fetchError } = await this.supabase
        .from("messages")
        .select("id, cluster_id")
        .not("cluster_id", "is", null)
        .is("campaign_id", null);

      if (fetchError) {
        throw fetchError;
      }

      if (!messagesToSync || messagesToSync.length === 0) {
        console.log("No messages need syncing");
        return 0;
      }

      // For now, this is a simple implementation that just returns the count
      // In a full implementation, you would need to have a way to determine which campaign
      // should be assigned to each cluster (e.g., via a cluster_campaigns table)
      console.log(
        `Found ${messagesToSync.length} messages that could be synced`,
      );
      console.log(
        "Note: Full sync implementation requires cluster-campaign mapping table",
      );

      return messagesToSync.length;
    } catch (error) {
      console.error("Error syncing campaign IDs from clusters:", error);
      throw error;
    }
  }

  calculateCentroid(embeddings: number[][]): number[] | null {
    if (embeddings.length === 0) {
      return null;
    }

    if (
      embeddings.some(
        (emb) => !Array.isArray(emb) || emb.length !== embeddings[0].length,
      )
    ) {
      console.error("Embeddings have inconsistent dimensions");
      return null;
    }

    const dimensions = embeddings[0].length;
    const centroid = new Array(dimensions).fill(0);

    for (const embedding of embeddings) {
      for (let i = 0; i < dimensions; i++) {
        centroid[i] += embedding[i];
      }
    }

    for (let i = 0; i < dimensions; i++) {
      centroid[i] /= embeddings.length;
    }

    return centroid;
  }

  // =============================================================================
  // MESSAGE OPERATIONS
  // =============================================================================

  private validatePrivacy(data: MessageInsert): void {
    // Verify that PII fields are not present in the payload
    const payload = data as any;
    const forbiddenFields = [
      "sender_email",
      "sender_name",
      "message",
      "body",
      "subject",
      "text_content",
      "html_content",
    ];

    const violations = forbiddenFields.filter(
      (field) => payload[field] !== undefined && payload[field] !== null,
    );

    if (violations.length > 0) {
      throw new Error(
        `Privacy violation: Cannot store PII in database. Found forbidden fields: ${violations.join(", ")}`,
      );
    }
  }

  async getDuplicateRank(
    senderHash: string,
    politicianId: number,
    campaignId: number,
  ): Promise<number> {
    try {
      const { count, error } = await this.supabase
        .from("messages")
        .select("*", { count: "exact", head: true })
        .eq("sender_hash", senderHash)
        .eq("politician_id", politicianId)
        .eq("campaign_id", campaignId);

      if (error) {
        throw error;
      }
      return count || 0;
    } catch (error) {
      console.error("Error getting duplicate rank:", error);
      return 0;
    }
  }

  async insertMessage(data: MessageInsert): Promise<number> {
    // Privacy validation: ensure no PII is being stored
    this.validatePrivacy(data);

    try {
      const { data: result, error } = await this.supabase
        .from("messages")
        .insert(data)
        .select("id");

      if (error) {
        throw error;
      }
      return result[0].id;
    } catch (error) {
      console.error("Error inserting message:", error);
      throw new Error("Failed to store message in database");
    }
  }

  async checkExternalIdExists(
    externalId: string,
    channelSource: string,
  ): Promise<boolean> {
    try {
      const { data, error } = await this.supabase
        .from("messages")
        .select("id")
        .eq("external_id", externalId)
        .eq("channel_source", channelSource)
        .limit(1);

      if (error) {
        throw error;
      }
      return data && data.length > 0;
    } catch (error) {
      console.error("Error checking external ID:", error);
      return false;
    }
  }

  async getMessageByExternalId(
    externalId: string,
    channelSource: string,
    politicianId: number,
  ): Promise<(MessageInsert & { id: number; campaigns: Campaign }) | null> {
    try {
      const { data, error } = await this.supabase
        .from("messages")
        .select("*, campaigns(id, name, slug)")
        .eq("external_id", externalId)
        .eq("politician_id", politicianId)
        .eq("channel_source", channelSource)
        .limit(1);

      if (error) {
        throw error;
      }
      if (!data || data.length === 0) {
        return null;
      }
      return data[0] as MessageInsert & { id: number; campaigns: Campaign };
    } catch (error) {
      console.error("Error getting message by external ID:", error);
      return null;
    }
  }

  // =============================================================================
  // REPLY TEMPLATE OPERATIONS
  // =============================================================================

  async getReplyTemplateById(id: number): Promise<ReplyTemplate | null> {
    try {
      const { data, error } = await this.supabase
        .from("reply_templates")
        .select("*")
        .eq("id", id)
        .limit(1);

      if (error) {
        throw error;
      }
      return data.length > 0 ? data[0] : null;
    } catch (error) {
      console.error("Error getting reply template:", error);
      return null;
    }
  }

  async getActiveTemplateForCampaign(
    campaignId: number,
    politicianId: number,
  ): Promise<ReplyTemplate | null> {
    try {
      const { data, error } = await this.supabase
        .from("reply_templates")
        .select("*")
        .eq("campaign_id", campaignId)
        .eq("politician_id", politicianId)
        .eq("active", true)
        .limit(1);

      if (error) {
        throw error;
      }
      return data && data.length > 0 ? data[0] : null;
    } catch (error) {
      console.error("Error getting active template:", error);
      return null;
    }
  }

  async deactivateOtherTemplates(
    campaignId: number,
    politicianId: number,
    excludeTemplateId?: number,
  ): Promise<void> {
    try {
      let query = this.supabase
        .from("reply_templates")
        .update({ active: false })
        .eq("campaign_id", campaignId)
        .eq("politician_id", politicianId);

      if (excludeTemplateId) {
        query = query.neq("id", excludeTemplateId);
      }

      const { error } = await query;

      if (error) {
        throw error;
      }
    } catch (error) {
      console.error("Error deactivating templates:", error);
      throw new Error("Failed to deactivate other templates");
    }
  }

  async updateReplyTemplate(
    id: number,
    updates: Partial<Omit<ReplyTemplate, "id" | "created_at" | "updated_at">>,
  ): Promise<ReplyTemplate> {
    try {
      const { data, error } = await this.supabase
        .from("reply_templates")
        .update(updates)
        .eq("id", id)
        .select();

      if (error) {
        throw error;
      }
      if (!data || data.length === 0) {
        throw new Error("Template not found");
      }
      return data[0];
    } catch (error) {
      console.error("Error updating reply template:", error);
      throw new Error("Failed to update reply template");
    }
  }

  async deleteReplyTemplate(id: number): Promise<void> {
    try {
      const { error } = await this.supabase
        .from("reply_templates")
        .delete()
        .eq("id", id);

      if (error) {
        throw error;
      }
    } catch (error) {
      console.error("Error deleting reply template:", error);
      throw new Error("Failed to delete reply template");
    }
  }

  async verifyPoliticianOwnsTemplate(templateId: number): Promise<boolean> {
    try {
      const { data, error } = await this.supabase
        .from("reply_templates")
        .select("id")
        .eq("id", templateId)
        .limit(1);

      if (error) {
        throw error;
      }
      return data && data.length > 0;
    } catch (error) {
      console.error("Error verifying template ownership:", error);
      return false;
    }
  }

  async userCanAccessPolitician(
    authUserId: string,
    politicianId: number,
  ): Promise<boolean> {
    try {
      const { data, error } = await this.supabase
        .from("politician_staff")
        .select("politician_id")
        .eq("user_id", authUserId)
        .eq("politician_id", politicianId)
        .limit(1);

      if (error) {
        throw error;
      }

      return !!data && data.length > 0;
    } catch (error) {
      console.error("Error checking politician access:", error);
      return false;
    }
  }

  async getUserPoliticianIds(authUserId: string): Promise<number[]> {
    try {
      const { data, error } = await this.supabase
        .from("politician_staff")
        .select("politician_id")
        .eq("user_id", authUserId);

      if (error) {
        throw error;
      }

      return (data || [])
        .map((row: { politician_id: number | null }) => row.politician_id)
        .filter((id: number | null): id is number => typeof id === "number");
    } catch (error) {
      console.error("Error fetching user politician scope:", error);
      return [];
    }
  }

  async userOwnsCampaign(
    authUserId: string,
    campaignId: number,
  ): Promise<boolean> {
    try {
      const { data, error } = await this.supabase
        .from("campaigns")
        .select("id")
        .eq("id", campaignId)
        .eq("created_by", authUserId)
        .limit(1);

      if (error) {
        throw error;
      }

      return !!data && data.length > 0;
    } catch (error) {
      console.error("Error checking campaign ownership:", error);
      return false;
    }
  }

  // =============================================================================
  // Reply pipeline: supporters (hash), send logs
  // =============================================================================

  async upsertSupporter(
    campaignId: number,
    politicianId: number,
    senderHash: string,
    firstMessageAt?: string,
  ): Promise<number | null> {
    try {
      const { data, error } = await this.supabase
        .from("supporters")
        .upsert(
          {
            campaign_id: campaignId,
            politician_id: politicianId,
            sender_hash: senderHash,
            first_message_at: firstMessageAt || new Date().toISOString(),
            last_message_at: firstMessageAt || new Date().toISOString(),
          },
          { onConflict: "campaign_id,politician_id,sender_hash" },
        )
        .select("id")
        .limit(1);

      if (error) {
        throw error;
      }

      return data && data.length > 0 ? data[0].id : null;
    } catch (error) {
      console.error("Error upserting supporter:", error);
      return null;
    }
  }

  /** Supporter aggregate rows for a campaign (hashes only; email lives in message_contacts). */
  async getSupportersForCampaign(campaignId: number): Promise<
    Array<{
      id: number;
      campaign_id: number;
      politician_id: number;
      sender_hash: string;
    }>
  > {
    try {
      const { data, error } = await this.supabase
        .from("supporters")
        .select("id,campaign_id,politician_id,sender_hash")
        .eq("campaign_id", campaignId);

      if (error) {
        throw error;
      }

      return (data || []) as Array<{
        id: number;
        campaign_id: number;
        politician_id: number;
        sender_hash: string;
      }>;
    } catch (error) {
      console.error("Error fetching supporters for campaign:", error);
      return [];
    }
  }

  async getCampaignTechnicalEmail(campaignId: number): Promise<string | null> {
    try {
      const { data, error } = await this.supabase
        .from("campaigns")
        .select("technical_email")
        .eq("id", campaignId)
        .limit(1);

      if (error) {
        throw error;
      }

      return data && data.length > 0
        ? (data[0].technical_email as string | null)
        : null;
    } catch (error) {
      console.error("Error fetching campaign technical email:", error);
      return null;
    }
  }

  async getCampaignIdsWithActiveReplyTemplate(): Promise<number[]> {
    const { data, error } = await this.supabase
      .from("reply_templates")
      .select("campaign_id")
      .eq("active", true);

    if (error) {
      console.error(
        "Error listing campaigns with active reply templates:",
        error,
      );
      throw error;
    }

    return Array.from(
      new Set(
        (data || [])
          .map((row) => row.campaign_id as number)
          .filter((id) => typeof id === "number"),
      ),
    );
  }

  /** Sets message reply fields after successful send. */
  async markMessageReplyDelivered(
    messageId: number,
    options?: { reply_id?: string; reply_template_id?: number },
  ): Promise<void> {
    const replySentAt = new Date().toISOString();
    const updateData: Record<string, string | number | null> = {
      reply_sent_at: replySentAt,
      processing_status: "replied",
    };

    if (options?.reply_id !== undefined) {
      updateData.reply_id = options.reply_id;
    }
    if (options?.reply_template_id !== undefined) {
      updateData.reply_template_id = options.reply_template_id;
    }

    const { error: msgError } = await this.supabase
      .from("messages")
      .update(updateData)
      .eq("id", messageId);

    if (msgError) {
      console.error("Error marking message reply sent:", msgError);
      throw msgError;
    }
  }

  async updateMessageFields(
    messageId: number,
    fields: Partial<{
      campaign_id: number | null;
      classification_confidence: number;
      duplicate_rank: number;
      reply_scheduled_at: string | null;
      processing_status: string;
    }>,
  ): Promise<void> {
    try {
      const { error } = await this.supabase
        .from("messages")
        .update(fields)
        .eq("id", messageId);

      if (error) {
        throw error;
      }
    } catch (error) {
      console.error("Error updating message fields:", error);
      throw error;
    }
  }

  async updateMessageRetryCount(
    messageId: number,
    retryCount: number,
    failureReason?: string,
    nextRetryAt?: string,
  ): Promise<void> {
    try {
      const updateData: any = {
        reply_retry_count: retryCount,
        reply_last_retry_at: new Date().toISOString(),
      };

      if (failureReason) {
        updateData.reply_failure_reason = failureReason;
      }

      if (nextRetryAt) {
        updateData.reply_scheduled_at = nextRetryAt;
      }

      const { error } = await this.supabase
        .from("messages")
        .update(updateData)
        .eq("id", messageId);

      if (error) {
        throw error;
      }
    } catch (error) {
      console.error("Error updating message retry count:", error);
      throw error;
    }
  }

  async markMessageAsFailed(
    messageId: number,
    failureReason: string,
  ): Promise<void> {
    try {
      const { error } = await this.supabase
        .from("messages")
        .update({
          reply_failure_reason: failureReason,
        })
        .eq("id", messageId);

      if (error) {
        throw error;
      }
    } catch (error) {
      console.error("Error marking message as failed:", error);
      throw error;
    }
  }

  async getMessageForReplyScheduling(messageId: number): Promise<{
    id: number;
    campaign_id: number | null;
    politician_id: number;
    sender_hash: string;
    received_at: string;
    duplicate_rank: number;
    reply_sent_at: string | null;
    reply_scheduled_at: string | null;
    processing_status: string;
  } | null> {
    const { data, error } = await this.supabase
      .from("messages")
      .select(
        "id, campaign_id, politician_id, sender_hash, received_at, duplicate_rank, reply_sent_at, reply_scheduled_at, processing_status",
      )
      .eq("id", messageId)
      .limit(1);

    if (error) {
      throw error;
    }

    return data && data.length > 0 ? data[0] : null;
  }

  async bulkUpdateMessageStatus(
    messageIds: number[],
    status: string,
    extraFields: Partial<{
      reply_sent_at: string;
      reply_failure_reason: string;
    }> = {},
  ): Promise<void> {
    if (messageIds.length === 0) return;

    try {
      const { error } = await this.supabase
        .from("messages")
        .update({
          processing_status: status,
          ...extraFields,
        })
        .in("id", messageIds);

      if (error) {
        throw error;
      }
    } catch (error) {
      console.error(`Error bulk updating messages to ${status}:`, error);
      throw error;
    }
  }

  async getMessagesReadyToSend(
    maxRetryAttempts: number,
    filters: {
      politicianId?: number;
      campaignId?: number;
      limit?: number;
    } = {},
  ): Promise<
    Array<{
      id: number;
      external_id: string;
      politician_id: number;
      campaign_id: number;
      sender_hash: string;
      reply_scheduled_at: string | null;
      received_at: string;
      reply_retry_count: number | null;
    }>
  > {
    const campaignIds = await this.getCampaignIdsWithActiveReplyTemplate();
    if (campaignIds.length === 0) {
      return [];
    }

    let query = this.supabase
      .from("messages")
      .select(
        "id, external_id, politician_id, campaign_id, sender_hash, reply_scheduled_at, received_at, reply_retry_count",
      )
      .eq("processing_status", "unanswered") // Only pick up messages not already being sent or replied
      .is("reply_sent_at", null)
      .in("campaign_id", campaignIds)
      //      .eq("duplicate_rank", 0)
      .lt("reply_retry_count", maxRetryAttempts)
      .or("reply_scheduled_at.is.null,reply_scheduled_at.lte.now()");

    if (filters.politicianId !== undefined) {
      query = query.eq("politician_id", filters.politicianId);
    }

    if (filters.campaignId !== undefined) {
      query = query.eq("campaign_id", filters.campaignId);
    }

    if (filters.limit !== undefined) {
      query = query.limit(filters.limit);
    }

    query = query.order("received_at", { ascending: true });

    const { data, error } = await query;

    if (error) {
      throw error;
    }

    return data || [];
  }

  async getCampaignById(campaignId: number): Promise<{
    id: number;
    name: string;
    technical_email: string | null;
    reply_to_email: string | null;
  } | null> {
    const { data, error } = await this.supabase
      .from("campaigns")
      .select("id, name, technical_email, reply_to_email")
      .eq("id", campaignId)
      .limit(1);

    if (error) {
      throw error;
    }

    return data && data.length > 0 ? data[0] : null;
  }

  async getPoliticianById(politicianId: number): Promise<{
    id: number;
    email: string;
    name: string;
    party: string;
    position: string;
    reply_to: string | null;
  } | null> {
    const { data, error } = await this.supabase
      .from("politicians")
      .select("id, email, name, reply_to, party,position")
      .eq("id", politicianId)
      .limit(1);

    if (error) {
      throw error;
    }

    return data && data.length > 0 ? data[0] : null;
  }

  // =============================================================================
  // CLASSIFICATION LOGIC
  // =============================================================================

  async classifyAndAssignToCluster(
    messageId: number,
    embedding: number[],
    politicianId: number,
    campaignHint?: string,
  ): Promise<ClassificationResult> {
    // Step 1: Classify the message
    const classification = await this.classifyMessage(
      embedding,
      politicianId,
      campaignHint,
    );

    // Step 2: Update message with campaign classification
    await this.updateMessageFields(messageId, {
      campaign_id: classification.campaign_id,
      classification_confidence: classification.confidence,
    });

    // Step 3: Assign to cluster for grouping similar messages
    await this.assignMessageToCluster(messageId, embedding, politicianId);

    return classification;
  }

  // =============================================================================
  // BATCH CLASSIFICATION & CLUSTERING
  // =============================================================================

  /**
   * Classify multiple messages at once.
   * Campaign hint lookups are batched into a single query;
   * vector similarity searches run concurrently via Promise.all.
   */
  async batchClassifyMessages(
    entries: Array<{
      embedding: number[];
      politicianId: number;
      campaignHint?: string;
    }>
  ): Promise<ClassificationResult[]> {
    const results: ClassificationResult[] = new Array(entries.length).fill(null);

    // Step 1: Batch campaign hint lookup — one query for all unique hints
    const hintedEntries = entries
      .map((e, i) => ({ ...e, originalIndex: i }))
      .filter((e) => !!e.campaignHint);

    const hintsDone = new Set<number>();

    if (hintedEntries.length > 0) {
      const { data: allCampaigns } = await this.supabase
        .from("campaigns")
        .select("id, name, slug")
        .in("status", ["active", "unconfirmed"]);

      for (const entry of hintedEntries) {
        const hint = entry.campaignHint!.toLowerCase();
        const match = (allCampaigns || []).find(
          (c) =>
            c.name?.toLowerCase().includes(hint) ||
            c.slug?.toLowerCase().includes(hint),
        );
        if (match) {
          results[entry.originalIndex] = {
            campaign_id: match.id,
            campaign_slug: match.slug || match.name,
            confidence: 0.95,
          };
          hintsDone.add(entry.originalIndex);
        }
      }
    }

    // Step 2: For remaining entries, run findSimilarCampaigns concurrently
    const vectorEntries = entries
      .map((e, i) => ({ embedding: e.embedding, originalIndex: i }))
      .filter((_, i) => !hintsDone.has(i));

    if (vectorEntries.length > 0) {
      const vectorResults = await Promise.all(
        vectorEntries.map(({ embedding }) =>
          this.findSimilarCampaigns(embedding, 3),
        ),
      );

      for (let j = 0; j < vectorEntries.length; j++) {
        const { originalIndex } = vectorEntries[j];
        const similar = vectorResults[j];
        if (similar.length > 0 && similar[0].distance < 0.1) {
          results[originalIndex] = {
            campaign_id: similar[0].id,
            campaign_slug: similar[0].slug,
            confidence: 1 - similar[0].distance,
          };
        } else {
          results[originalIndex] = {
            campaign_id: null,
            campaign_slug: null,
            confidence: 0.1,
          };
        }
      }
    }

    // Fill any remaining nulls (guard for correctness)
    for (let i = 0; i < results.length; i++) {
      if (!results[i]) {
        results[i] = { campaign_id: null, campaign_slug: null, confidence: 0.1 };
      }
    }

    return results;
  }

  /**
   * Assign multiple messages to clusters under a single global lock window.
   * Handles intra-batch similarity so two messages in the same batch that
   * are similar to each other end up in the same cluster.
   */
  async batchAssignToClusters(
    messageIds: number[],
    embeddings: number[][],
    _politicianId: number,
  ): Promise<(number | null)[]> {
    if (messageIds.length === 0) return [];

    const lockAcquired = await this.acquireGlobalClusteringLock();
    if (!lockAcquired) {
      console.log("  ⏳ Could not acquire global clustering lock, retrying...");
      await new Promise((resolve) => setTimeout(resolve, 100));
      return this.batchAssignToClusters(messageIds, embeddings, _politicianId);
    }

    try {
      const n = messageIds.length;
      const clusterIds: (number | null)[] = new Array(n).fill(null);
      const orphans: Array<{ msgIdx: number; msgId: number; embedding: number[] }> = [];

      // Phase 1: Try to match each embedding to an existing cluster
      for (let i = 0; i < n; i++) {
        const similarClusters = await this.findSimilarClusters(embeddings[i], 50);

        if (similarClusters.length > 0) {
          const selectedCluster = [...similarClusters].sort((a, b) => {
            if (b.messageCount !== a.messageCount) {
              return b.messageCount - a.messageCount;
            }
            return a.distance - b.distance;
          })[0];

          clusterIds[i] = selectedCluster.clusterId;
        } else {
          orphans.push({ msgIdx: i, msgId: messageIds[i], embedding: embeddings[i] });
        }
      }

      // Phase 2: For orphans, check similarity against all unclustered messages
      // and also against other orphans in this batch
      for (let oi = 0; oi < orphans.length; oi++) {
        if (clusterIds[orphans[oi].msgIdx] !== null) continue;

        const similarMessages = await this.findSimilarMessages(
          orphans[oi].embedding,
          50,
        );
        const closeMatches = similarMessages.filter(
          (m) => m.id !== orphans[oi].msgId && m.distance < 0.1,
        );

        const existingClusterMatch = closeMatches.find(
          (m) => m.cluster_id !== null,
        );

        if (existingClusterMatch?.cluster_id) {
          clusterIds[orphans[oi].msgIdx] = existingClusterMatch.cluster_id;
        } else {
          // Check intra-batch: are there other orphans close to this one?
          const closeOrphans = orphans.filter(
            (other, oj) =>
              oj !== oi &&
              clusterIds[other.msgIdx] === null &&
              this._cosineDistance(orphans[oi].embedding, other.embedding) < 0.1,
          );

          if (closeOrphans.length > 0) {
            const groupEmbeddings = [
              orphans[oi].embedding,
              ...closeOrphans.map((co) => co.embedding),
            ];
            const groupMessageIds = [
              orphans[oi].msgId,
              ...closeOrphans.map((co) => co.msgId),
            ];
            const centroid = this.calculateCentroid(groupEmbeddings);
            const centroidStr = centroid
              ? `[${centroid.join(",")}]`
              : `[${orphans[oi].embedding.join(",")}]`;

            const { data: newCluster } = await this.supabase
              .from("message_clusters")
              .insert({
                centroid_vector: centroidStr,
                message_count: groupMessageIds.length,
                status: "forming",
              })
              .select("id")
              .single();

            if (newCluster?.id) {
              clusterIds[orphans[oi].msgIdx] = newCluster.id;
              for (const co of closeOrphans) {
                clusterIds[co.msgIdx] = newCluster.id;
              }
            }
          } else {
            const { data: newCluster } = await this.supabase
              .from("message_clusters")
              .insert({
                centroid_vector: `[${orphans[oi].embedding.join(",")}]`,
                message_count: 1,
                status: "forming",
              })
              .select("id")
              .single();

            if (newCluster?.id) {
              clusterIds[orphans[oi].msgIdx] = newCluster.id;
            }
          }
        }
      }

      // Phase 3: Bulk UPDATE all messages with their cluster_ids
      const clusterUpdates = new Map<number | null, number[]>();
      for (let i = 0; i < n; i++) {
        const cid = clusterIds[i];
        if (!clusterUpdates.has(cid)) clusterUpdates.set(cid, []);
        clusterUpdates.get(cid)!.push(messageIds[i]);
      }

      for (const [cid, ids] of clusterUpdates) {
        if (cid === null) continue;
        await this.supabase
          .from("messages")
          .update({ cluster_id: cid })
          .in("id", ids);
      }

      // Phase 4: Update centroids and check readiness for affected clusters
      const affectedClusterIds = new Set(
        clusterIds.filter((c): c is number => c !== null),
      );
      for (const cid of affectedClusterIds) {
        await this.updateClusterCentroid(cid);
        await this.checkClusterReadiness(cid);
      }

      return clusterIds;
    } catch (error) {
      console.error("Error in batchAssignToClusters:", error);
      return new Array(messageIds.length).fill(null);
    } finally {
      await this.releaseGlobalClusteringLock();
    }
  }

  /**
   * Compute duplicate ranks for multiple messages in a single query.
   * Returns a map keyed by `${senderHash}:${politicianId}:${campaignId}`.
   */
  async batchGetDuplicateRanks(
    entries: Array<{
      senderHash: string;
      politicianId: number;
      campaignId: number;
    }>,
  ): Promise<Map<string, number>> {
    const result = new Map<string, number>();
    if (entries.length === 0) return result;

    const senderHashes = [...new Set(entries.map((e) => e.senderHash))];
    const campaignIds = [...new Set(entries.map((e) => e.campaignId))];
    const politicianId = entries[0].politicianId;

    try {
      const { data, error } = await this.supabase
        .from("messages")
        .select("sender_hash, campaign_id")
        .eq("politician_id", politicianId)
        .in("sender_hash", senderHashes)
        .in("campaign_id", campaignIds);

      if (error) throw error;

      const counter = new Map<string, number>();
      for (const row of data || []) {
        const key = `${row.sender_hash}:${politicianId}:${row.campaign_id}`;
        counter.set(key, (counter.get(key) || 0) + 1);
      }

      for (const entry of entries) {
        const key = `${entry.senderHash}:${entry.politicianId}:${entry.campaignId}`;
        result.set(key, counter.get(key) || 0);
      }
    } catch (error) {
      console.error("Error in batchGetDuplicateRanks:", error);
    }

    return result;
  }

  /**
   * Upsert multiple supporters in a single operation.
   */
  async batchUpsertSupporters(
    entries: Array<{
      campaignId: number;
      politicianId: number;
      senderHash: string;
      firstMessageAt: string;
    }>,
  ): Promise<void> {
    if (entries.length === 0) return;

    try {
      const rows = entries.map((e) => ({
        campaign_id: e.campaignId,
        politician_id: e.politicianId,
        sender_hash: e.senderHash,
        first_message_at: e.firstMessageAt,
        last_message_at: e.firstMessageAt,
      }));

      await this.supabase
        .from("supporters")
        .upsert(rows, { onConflict: "campaign_id,politician_id,sender_hash" });
    } catch (error) {
      console.error("Error in batchUpsertSupporters:", error);
    }
  }

  /**
   * Update multiple message rows with different field values.
   * Groups updates by identical field sets to minimize HTTP calls.
   */
  async batchUpdateMessageFields(
    updates: Array<{
      messageId: number;
      fields: Record<string, unknown>;
    }>,
  ): Promise<void> {
    if (updates.length === 0) return;

    const groups = new Map<string, { fields: Record<string, unknown>; ids: number[] }>();
    for (const u of updates) {
      const key = JSON.stringify(u.fields);
      if (!groups.has(key)) {
        groups.set(key, { fields: { ...u.fields }, ids: [] });
      }
      groups.get(key)!.ids.push(u.messageId);
    }

    await Promise.all(
      [...groups.values()].map(({ fields, ids }) =>
        this.supabase
          .from("messages")
          .update(fields)
          .in("id", ids),
      ),
    );
  }

  /** Cosine distance between two embeddings (used for intra-batch comparison). */
  private _cosineDistance(a: number[], b: number[]): number {
    let dot = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }
    if (normA === 0 || normB === 0) return 1;
    return 1 - dot / (Math.sqrt(normA) * Math.sqrt(normB));
  }

  async classifyMessage(
    embedding: number[],
    _politicianId: number,
    campaignHint?: string,
  ): Promise<ClassificationResult> {
    // Step 1: Try campaign hint if provided
    if (campaignHint) {
      const hintCampaign = await this.findCampaignByHint(campaignHint);
      if (hintCampaign) {
        return {
          campaign_id: hintCampaign.id,
          campaign_name: hintCampaign.name,
          confidence: 0.95,
        };
      }
    }

    // Step 2: Try vector distance
    const similarCampaigns = await this.findSimilarCampaigns(embedding, 3);

    if (similarCampaigns.length > 0) {
      const best = similarCampaigns[0];

      // If distance is low enough, use existing campaign
      if (best.distance < 0.1) {
        return {
          campaign_id: best.id,
          campaign_slug: best.slug,
          confidence: 1 - best.distance, // Convert distance to confidence
        };
      }
    }

    // No confident match: no campaign assigned (campaign_id null)
    return {
      campaign_id: null,
      campaign_name: null,
      confidence: 0.1,
    };
  }
}

// =============================================================================
// UTILITY FUNCTIONS
// =============================================================================

export async function hashEmail(email: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(email.toLowerCase().trim());
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

// =============================================================================
// REQUIRED POSTGRESQL FUNCTIONS
// =============================================================================

/*
You'll need to create this PostgreSQL function in Supabase for vector distance:

CREATE OR REPLACE FUNCTION find_similar_campaigns(
  query_embedding vector(1024),
  distance_threshold float DEFAULT 0.1,
  match_limit int DEFAULT 3
)
RETURNS TABLE (
  id int,
  name text,
  slug text,
  status text,
  reference_vector vector(1024),
  distance float
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    c.id,
    c.name,
    c.slug,
    c.status,
    c.reference_vector,
    (c.reference_vector <=> query_embedding) as distance
  FROM campaigns c
  WHERE c.reference_vector IS NOT NULL 
    AND c.status IN ('active', 'unconfirmed')
    AND (c.reference_vector <=> query_embedding) <= distance_threshold
  ORDER BY c.reference_vector <=> query_embedding
  LIMIT match_limit;
END;
$$;
*/
