import { type SupabaseClient, createClient } from "@supabase/supabase-js";

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
  layout_type: 'text_only' | 'standard_header';
  send_timing: 'immediate' | 'office_hours' | 'scheduled';
  scheduled_for?: string | null;
  created_at: string;
  updated_at: string;
}

export interface ClassificationResult {
  campaign_id: number;
  campaign_name: string;
  confidence: number;
}

export class DatabaseClient {
  private supabase: SupabaseClient;

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
        let query: any = this.supabase.from(table).select(queryParams.get("select") || "*");

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
          query = query.limit(Number.parseInt(queryParams.get("limit") || "0"));
        }

        const { data, error } = await query;
        if (error) {
          throw new Error(`Database error: ${error.message}`);
        }
        return data as T;
      }

      if (method === "POST") {
        const { data, error } = await this.supabase.from(table).insert(body).select();
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
        const { error } = await this.supabase.from(table).delete().eq("id", deleteId);
        if (error) {
          throw new Error(`Database error: ${error.message}`);
        }
        return [] as T;
      }

      throw new Error(`Unsupported request method: ${method}`);
    } catch (error) {
      throw error instanceof Error ? error : new Error("Unknown database request error");
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

      // Fallback: get all active campaigns without similarity
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

  async getUncategorizedCampaign(): Promise<Campaign> {
    try {
      const { data: campaigns, error } = await this.supabase
        .from("campaigns")
        .select("id,name,slug,status")
        .eq("slug", "uncategorized");

      if (error) {
        throw error;
      }
      if (campaigns.length > 0) {
        return campaigns[0];
      }

      // Create uncategorized campaign
      const { data: newCampaigns, error: createError } = await this.supabase
        .from("campaigns")
        .insert({
          name: "Uncategorized",
          slug: "uncategorized",
          description: "Messages that could not be automatically categorized",
          status: "active",
          created_by: "system",
        })
        .select();

      if (createError) {
        throw createError;
      }
      return newCampaigns[0];
    } catch (error) {
      console.error("Error getting uncategorized campaign:", error);
      throw new Error("Failed to get or create uncategorized campaign");
    }
  }

  // =============================================================================
  // MESSAGE CLUSTERING
  // =============================================================================

  private static readonly MIN_CLUSTER_SIZE_FOR_CAMPAIGN = 2;

  private async acquireGlobalClusteringLock(): Promise<boolean> {
    try {
      const { data, error } = await this.supabase.rpc('acquire_global_clustering_lock');

      if (error) {
        console.error('Error acquiring advisory lock:', error);
        return false;
      }

      return data === true;
    } catch (error) {
      console.error('Exception acquiring advisory lock:', error);
      return false;
    }
  }

  private async releaseGlobalClusteringLock(): Promise<void> {
    try {
      await this.supabase.rpc('release_global_clustering_lock');
    } catch (error) {
      console.error('Error releasing advisory lock:', error);
    }
  }

  async findSimilarMessages(
    embedding: number[],
    limit = 10,
  ): Promise<Array<{ id: number; distance: number; campaign_id: number | null; cluster_id: number | null; politician_id: number }>> {
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
        console.log(`  🔍 RPC returned ${data.length} messages, distances: ${data.slice(0, 3).map((m: any) => m.distance?.toFixed(4)).join(', ')}`);
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
  ): Promise<Array<{ clusterId: number; distance: number; messageCount: number }>> {
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
      await new Promise(resolve => setTimeout(resolve, 100));
      return this.assignMessageToCluster(messageId, embedding, politicianId);
    }

    try {
      const similarClusters = await this.findSimilarClusters(embedding, 50);

      if (similarClusters.length > 0) {
        const selectedCluster = [...similarClusters]
          .sort((a, b) => {
            // Primary: Closest distance first
            if (Math.abs(a.distance - b.distance) > 0.001) {
              return a.distance - b.distance;
            }
            // Secondary: Larger clusters first (only when distances are very similar)
            return b.messageCount - a.messageCount;
          })[0];

        console.log(`  ✅ Joining existing cluster ${selectedCluster.clusterId} by centroid (distance: ${selectedCluster.distance.toFixed(4)}, size: ${selectedCluster.messageCount})`);

        await this.supabase
          .from("messages")
          .update({ cluster_id: selectedCluster.clusterId })
          .eq("id", messageId);

        await this.updateClusterCentroid(selectedCluster.clusterId);
        await this.checkClusterReadiness(selectedCluster.clusterId);

        return selectedCluster.clusterId;
      }

      console.log(`  🔍 No similar clusters by centroid, checking similar unclustered messages`);
      const similarMessages = await this.findSimilarMessages(embedding, 50);
      const closeMatches = similarMessages.filter(
        m => m.id !== messageId && m.distance < 0.1,
      );

      const existingClusterFromCloseMatches = closeMatches.find(
        m => m.cluster_id !== null,
      );

      if (existingClusterFromCloseMatches?.cluster_id) {
        const clusterId = existingClusterFromCloseMatches.cluster_id;
        console.log(`  ✅ Joining existing cluster ${clusterId} via fallback close-match logic`);

        await this.supabase
          .from("messages")
          .update({ cluster_id: clusterId })
          .eq("id", messageId);

        const unclusteredSimilarMessageIds = closeMatches
          .filter(m => m.cluster_id === null)
          .map(m => m.id);

        if (unclusteredSimilarMessageIds.length > 0) {
          console.log(`  🔗 Also assigning ${unclusteredSimilarMessageIds.length} unclustered similar messages to cluster ${clusterId}`);
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
        m => m.cluster_id === null,
      );

      if (unclusteredSimilarMessages.length > 0) {
        console.log(`  🆕 Creating cluster for ${unclusteredSimilarMessages.length + 1} similar unclustered messages`);
        const { data: newCluster, error: createError } = await this.supabase
          .from("message_clusters")
          .insert({
            centroid_vector: `[${embedding.join(',')}]`,
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
        const allMessageIds = [messageId, ...unclusteredSimilarMessages.map(m => m.id)];

        await this.supabase
          .from("messages")
          .update({ cluster_id: newClusterId })
          .in("id", allMessageIds);

        await this.updateClusterCentroid(newClusterId);
        await this.checkClusterReadiness(newClusterId);

        return newClusterId;
      }

      console.log(`  🆕 Creating isolated cluster (no similar clusters or messages)`);
      const { data: newCluster, error: createError } = await this.supabase
        .from("message_clusters")
        .insert({
          centroid_vector: `[${embedding.join(',')}]`,
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
        .map(m => {
          const emb = m.message_embedding;
          // Handle both string and array formats
          if (typeof emb === 'string') {
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
            centroid_vector: `[${centroid.join(',')}]`,
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

      if (cluster && cluster.message_count >= DatabaseClient.MIN_CLUSTER_SIZE_FOR_CAMPAIGN && cluster.status === "forming") {
        await this.supabase
          .from("message_clusters")
          .update({ status: "ready" })
          .eq("id", clusterId);
      }
    } catch (error) {
      console.error(`Error checking cluster ${clusterId} readiness:`, error);
    }
  }

  calculateCentroid(embeddings: number[][]): number[] | null {
    if (embeddings.length === 0) return null;

    if (embeddings.some(emb => !Array.isArray(emb) || emb.length !== embeddings[0].length)) {
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
      'sender_email',
      'sender_name',
      'message',
      'body',
      'subject',
      'text_content',
      'html_content'
    ];

    const violations = forbiddenFields.filter(field =>
      payload[field] !== undefined && payload[field] !== null
    );

    if (violations.length > 0) {
      throw new Error(
        `Privacy violation: Cannot store PII in database. Found forbidden fields: ${violations.join(', ')}`
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
      // @ts-ignore - Supabase types are sometimes tricky with joins
      return data.length > 0 ? data[0] : null;
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

  async verifyPoliticianOwnsTemplate(
    templateId: number,
  ): Promise<boolean> {
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
  // SENDER EMAIL OPERATIONS (for auto-reply)
  // =============================================================================

  async storeSenderEmail(
    messageId: number,
    senderHash: string,
    senderEmail: string,
  ): Promise<void> {
    try {
      const { error } = await this.supabase
        .from("sender_emails")
        .insert({
          message_id: messageId,
          sender_hash: senderHash,
          email: senderEmail,
        });

      if (error) {
        throw error;
      }
    } catch (error) {
      console.error("Error storing sender email:", error);
      throw new Error("Failed to store sender email");
    }
  }

  async getSenderEmailByMessageId(messageId: number): Promise<string | null> {
    try {
      const { data, error } = await this.supabase
        .from("sender_emails")
        .select("email")
        .eq("message_id", messageId)
        .eq("reply_sent", false)
        .is("purged_at", null)
        .limit(1);

      if (error) {
        throw error;
      }

      return data && data.length > 0 ? data[0].email : null;
    } catch (error) {
      console.error("Error getting sender email:", error);
      return null;
    }
  }

  async upsertSupporter(
    campaignId: number,
    politicianId: number,
    senderHash: string,
    email: string,
    name?: string,
  ): Promise<number | null> {
    try {
      const { data, error } = await this.supabase
        .from("supporters")
        .upsert(
          {
            campaign_id: campaignId,
            politician_id: politicianId,
            sender_hash: senderHash,
            email,
            name: name || null,
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
    sender_email: string;
    recipient_email: string;
    subject: string;
    status: "sent" | "failed";
    provider?: string;
    provider_message_id?: string;
    error_message?: string;
  }): Promise<void> {
    try {
      const { error } = await this.supabase.from("email_logs").insert({
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

  // =============================================================================
  // ANALYTICS OPERATIONS
  // =============================================================================

  async getMessageAnalytics(
    daysBack = 7,
  ): Promise<Array<{ hour: string; campaign_id: number; campaign_name: string; message_count: number }>> {
    try {
      const { data, error } = await this.supabase.rpc("get_message_analytics", {
        days_back: daysBack,
      });

      if (error) {
        throw error;
      }

      return data || [];
    } catch (error) {
      console.error("Error fetching message analytics:", error);
      throw new Error("Failed to fetch message analytics");
    }
  }

  // =============================================================================
  // CLASSIFICATION LOGIC
  // =============================================================================

  async classifyMessage(
    embedding: number[],
    politicianId: number,
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

    // Step 2: Try vector similarity
    const similarCampaigns = await this.findSimilarCampaigns(embedding, 3);

    if (similarCampaigns.length > 0) {
      const best = similarCampaigns[0];

      // If distance is low enough, use existing campaign
      if (best.distance <= 0.1) {
        return {
          campaign_id: best.id,
          campaign_name: best.name,
          confidence: 1 - best.distance,
        };
      }
    }

    // Step 3: Fall back to uncategorized
    const uncategorized = await this.getUncategorizedCampaign();

    return {
      campaign_id: uncategorized.id,
      campaign_name: uncategorized.name,
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
You'll need to create this PostgreSQL function in Supabase for vector similarity:

CREATE OR REPLACE FUNCTION find_similar_campaigns(
  query_embedding vector(1024),
  similarity_threshold float DEFAULT 0.1,
  match_limit int DEFAULT 3
)
RETURNS TABLE (
  id int,
  name text,
  slug text,
  status text,
  reference_vector vector(1024),
  similarity float
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
    (1 - (c.reference_vector <-> query_embedding)) as similarity
  FROM campaigns c
  WHERE c.reference_vector IS NOT NULL 
    AND c.status IN ('active', 'unconfirmed')
    AND (1 - (c.reference_vector <-> query_embedding)) > similarity_threshold
  ORDER BY c.reference_vector <-> query_embedding
  LIMIT match_limit;
END;
$$;
*/
