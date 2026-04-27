import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Database Layer - Supabase REST API Client
// Handles all database operations for Circular Democracy

interface SupabaseConfig {
  url: string;
  key: string;
}

export interface Politician {
  id: number;
  name: string;
  email: string;
  additional_emails: string[];
  active: boolean;
  stalwart_jmap_endpoint?: string | null;
  stalwart_jmap_account_id?: string | null;
  stalwart_username?: string | null;
  stalwart_app_password?: string | null;
  stalwart_app_password_secret_name?: string | null;
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
  reply_status?: "pending" | "scheduled" | null;
  reply_scheduled_at?: string | null;
  sender_flag?: string;
  is_reply?: boolean;
  stalwart_message_id?: string;
  stalwart_account_id?: string;
}

export interface ReplyTemplate {
  id: number;
  campaign_id: number;
  name: string;
  subject: string;
  body: string;
  active: boolean;
  layout_type: "text_only" | "standard_header";
  send_timing: "immediate" | "office_hours" | "scheduled";
  scheduled_for?: string | null;
  created_at: string;
  updated_at: string;
}

export interface ClassificationResult {
  campaign_id: number | null;
  campaign_name: string | null;
  confidence: number;
}

export class DatabaseClient {
  public supabase: SupabaseClient;

  constructor(config: SupabaseConfig) {
    this.supabase = createClient(config.url, config.key, {
      auth: {
        persistSession: false,
      },
      global: {
        fetch: (...args) => fetch(...args),
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
        .select("id,name,email,additional_emails,active")
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
        .select("id,name,email,additional_emails,active")
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
  ): Promise<(MessageInsert & { id: number; campaigns: Campaign }) | null> {
    try {
      const { data, error } = await this.supabase
        .from("messages")
        .select("*, campaigns(id, name)")
        .eq("external_id", externalId)
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
  ): Promise<ReplyTemplate | null> {
    try {
      const { data, error } = await this.supabase
        .from("reply_templates")
        .select("*")
        .eq("campaign_id", campaignId)
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
    excludeTemplateId?: number,
  ): Promise<void> {
    try {
      let query = this.supabase
        .from("reply_templates")
        .update({ active: false })
        .eq("campaign_id", campaignId);

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
  // Reply pipeline: supporters (hash), message_contacts (PII), send logs
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
            last_message_at: new Date().toISOString(),
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
  async getSupportersForCampaign(
    campaignId: number,
  ): Promise<
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

  async storeMessageContact(params: {
    messageId: number;
    senderHash: string;
    senderEmail: string;
    senderName?: string;
    capturedAt?: string;
  }): Promise<void> {
    try {
      const { error } = await this.supabase.from("message_contacts").upsert(
        {
          message_id: params.messageId,
          sender_hash: params.senderHash,
          sender_email: params.senderEmail,
          sender_name: params.senderName || null,
          contact_captured_at: params.capturedAt || new Date().toISOString(),
        },
        { onConflict: "message_id" },
      );

      if (error) {
        throw error;
      }
    } catch (error) {
      console.error("Error storing message contact:", error);
      throw new Error("Failed to store short-term message contact");
    }
  }

  async getMessageContactEmail(messageId: number): Promise<string | null> {
    try {
      const { data, error } = await this.supabase
        .from("message_contacts")
        .select("sender_email")
        .eq("message_id", messageId)
        .is("purged_at", null)
        .limit(1);

      if (error) {
        throw error;
      }

      return data && data.length > 0 ? (data[0].sender_email as string) : null;
    } catch (error) {
      console.error("Error fetching message contact email:", error);
      return null;
    }
  }

  async getCampaignBroadcastRecipients(campaignId: number): Promise<
    Array<{
      sender_hash: string;
      politician_id: number;
      email: string;
    }>
  > {
    try {
      const supporters = await this.getSupportersForCampaign(campaignId);
      if (supporters.length === 0) {
        return [];
      }

      const { data: contacts, error } = await this.supabase
        .from("message_contacts")
        .select(
          "sender_hash,sender_email,contact_captured_at,messages!inner(campaign_id,politician_id)",
        )
        .is("purged_at", null);

      if (error) {
        throw error;
      }

      const byKey = new Map<
        string,
        { email: string; capturedAt: string; sender_hash: string; politician_id: number }
      >();

      for (const row of (contacts || []) as any[]) {
        const msg = Array.isArray(row.messages) ? row.messages[0] : row.messages;
        if (!msg || msg.campaign_id !== campaignId) {
          continue;
        }
        const key = `${campaignId}:${msg.politician_id}:${row.sender_hash}`;
        const existing = byKey.get(key);
        if (
          !existing ||
          new Date(row.contact_captured_at) > new Date(existing.capturedAt)
        ) {
          byKey.set(key, {
            email: row.sender_email,
            capturedAt: row.contact_captured_at,
            sender_hash: row.sender_hash,
            politician_id: msg.politician_id,
          });
        }
      }

      const supporterKeys = new Set(
        supporters.map(
          (s) => `${s.campaign_id}:${s.politician_id}:${s.sender_hash}`,
        ),
      );

      return Array.from(byKey.entries())
        .filter(([key]) => supporterKeys.has(key))
        .map(([, value]) => ({
          sender_hash: value.sender_hash,
          politician_id: value.politician_id,
          email: value.email,
        }));
    } catch (error) {
      console.error("Error building campaign broadcast recipients:", error);
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

  async logEmailEvent(data: {
    message_id: number;
    campaign_id: number;
    politician_id: number;
    supporter_id?: number | null;
    subject: string;
    status: "sent" | "failed";
    provider?: string;
    provider_message_id?: string;
    error_message?: string;
  }): Promise<void> {
    try {
      const { error } = await this.supabase.from("reply_send_logs").insert({
        ...data,
        provider: data.provider || "jmap",
      });
      if (error) {
        throw error;
      }
    } catch (error) {
      console.error("Error logging email event:", error);
    }
  }


  /**
   * Creates a minimal broadcast message for a supporter without storing any PII in the messages table.
   */
  async createBroadcastMessageForSupporter(params: {
    campaignId: number;
    politicianId: number;
    senderHash: string;
    replyStatus?: "pending" | "scheduled";
    replyScheduledAt?: string | null;
  }): Promise<number | null> {
    const {
      campaignId,
      politicianId,
      senderHash,
      replyStatus = "pending",
      replyScheduledAt = null,
    } = params;

    try {
      const externalId = `broadcast:${campaignId}:${senderHash}:${Date.now()}`;

      const { data, error } = await this.supabase
        .from("messages")
        .insert({
          external_id: externalId,
          channel: "broadcast",
          channel_source: "broadcast",
          politician_id: politicianId,
          sender_hash: senderHash,
          campaign_id: campaignId,
          classification_confidence: 0,
          language: "auto",
          received_at: new Date().toISOString(),
          duplicate_rank: 0,
          processing_status: "processed",
          reply_status: replyStatus,
          reply_scheduled_at: replyScheduledAt,
        })
        .select("id")
        .single();

      if (error) {
        throw error;
      }

      return data?.id ?? null;
    } catch (error) {
      console.error("Error creating broadcast message for supporter:", error);
      return null;
    }
  }

  /** Sets message reply fields and removes short-term contact row. */
  async markMessageReplyDelivered(messageId: number): Promise<void> {
    const replySentAt = new Date().toISOString();

    const { error: msgError } = await this.supabase
      .from("messages")
      .update({
        reply_status: "sent",
        reply_sent_at: replySentAt,
      })
      .eq("id", messageId);

    if (msgError) {
      console.error("Error marking message reply sent:", msgError);
      throw msgError;
    }

    const { error: contactDeleteError } = await this.supabase
      .from("message_contacts")
      .delete()
      .eq("message_id", messageId);

    if (contactDeleteError) {
      console.error("Error deleting message_contacts row:", contactDeleteError);
      throw contactDeleteError;
    }
  }

  async updateMessageFields(
    messageId: number,
    fields: Partial<{
      campaign_id: number;
      classification_confidence: number;
      duplicate_rank: number;
      reply_status: "pending" | "scheduled" | null;
      reply_scheduled_at: string | null;
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
        updateData.reply_status = "scheduled";
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
          reply_status: null,
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

  async getMessagesReadyToSend(maxRetryAttempts: number): Promise<Array<{
    id: number;
    external_id: string;
    politician_id: number;
    campaign_id: number;
    sender_hash: string;
    reply_status: "pending" | "scheduled";
    reply_scheduled_at: string | null;
    received_at: string;
    reply_retry_count: number | null;
  }>> {
    const { data, error } = await this.supabase
      .from("messages")
      .select(
        "id, external_id, politician_id, campaign_id, sender_hash, reply_status, reply_scheduled_at, received_at, reply_retry_count",
      )
      .in("reply_status", ["pending", "scheduled"])
      .is("reply_sent_at", null)
      .lt("reply_retry_count", maxRetryAttempts)
      .or("reply_scheduled_at.is.null,reply_scheduled_at.lte.now()");

    if (error) {
      throw error;
    }

    return data || [];
  }

  async getMessageReadyToSendById(messageId: number): Promise<{
    id: number;
    external_id: string;
    politician_id: number;
    campaign_id: number;
    sender_hash: string;
    reply_status: "pending" | "scheduled";
    reply_scheduled_at: string | null;
    received_at: string;
    reply_retry_count: number | null;
  } | null> {
    const { data, error } = await this.supabase
      .from("messages")
      .select(
        "id, external_id, politician_id, campaign_id, sender_hash, reply_status, reply_scheduled_at, received_at, reply_retry_count",
      )
      .eq("id", messageId)
      .in("reply_status", ["pending", "scheduled"])
      .is("reply_sent_at", null)
      .limit(1);

    if (error) {
      throw error;
    }

    return data && data.length > 0 ? data[0] : null;
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
    stalwart_jmap_endpoint: string | null;
    stalwart_jmap_account_id: string | null;
    stalwart_username: string | null;
    stalwart_app_password_secret_name: string | null;
  } | null> {
    const { data, error } = await this.supabase
      .from("politicians")
      .select(
        "id, email, name, stalwart_jmap_endpoint, stalwart_jmap_account_id, stalwart_username, stalwart_app_password_secret_name",
      )
      .eq("id", politicianId)
      .limit(1);

    if (error) {
      throw error;
    }

    return data && data.length > 0 ? data[0] : null;
  }

  async markMessageAsSent(messageId: number): Promise<void> {
    const { error } = await this.supabase
      .from("messages")
      .update({
        reply_status: "sent",
        reply_sent_at: new Date().toISOString(),
      })
      .eq("id", messageId);

    if (error) {
      throw error;
    }
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
      campaign_id: classification.campaign_id ?? undefined,
      classification_confidence: classification.confidence,
    });

    // Step 3: Assign to cluster only when campaign is still unknown
    if (classification.campaign_id === null) {
      await this.assignMessageToCluster(messageId, embedding, politicianId);
    }

    return classification;
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
          campaign_name: best.name,
          confidence: 1 - best.distance, // Convert distance to confidence
        };
      }
    }

    // Step 3: No reliable match -> keep campaign unset
    return {
      campaign_id: null,
      campaign_name: null,
      confidence: 0.1,
    };
  }

  // =============================================================================
  // ANALYTICS OPERATIONS
  // =============================================================================

  async getMessageAnalyticsDaily(daysBack: number): Promise<
    Array<{
      date: string;
      campaign_id: number;
      campaign_name: string;
      message_count: number;
    }>
  > {
    try {
      const { data, error } = await this.supabase.rpc(
        "get_message_analytics_daily",
        {
          days_back: daysBack,
        },
      );

      if (error) {
        throw error;
      }

      return data || [];
    } catch (error) {
      console.error("Error fetching message analytics:", error);
      return [];
    }
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
