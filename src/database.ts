import { createClient, SupabaseClient } from '@supabase/supabase-js';

// Database Layer - Supabase REST API Client
// Handles all database operations for Circular Democracy

interface SupabaseConfig {
  url: string
  key: string
}

export interface Politician {
  id: number
  name: string
  email: string
  additional_emails: string[]
  active: boolean
}

export interface Campaign {
  id: number
  name: string
  slug: string
  status: string
  reference_vector?: number[]
}

export interface MessageInsert {
  external_id: string
  channel: string
  channel_source: string
  politician_id: number
  sender_hash: string
  campaign_id: number
  classification_confidence: number
  message_embedding: number[]
  language: string
  received_at: string
  duplicate_rank: number
  processing_status: string
}

export interface ClassificationResult {
  campaign_id: number
  campaign_name: string
  confidence: number
}

export class DatabaseClient {
  private supabase: SupabaseClient;

  constructor(config: SupabaseConfig) {
    this.supabase = createClient(config.url, config.key);
  }

  async request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    const query = this.supabase.from(endpoint).select('*');

    const { data, error } = await query;

    if (error) {
      throw new Error(`Database error: ${error.message}`);
    }

    return data as T;
  }

  // =============================================================================
  // POLITICIAN OPERATIONS
  // =============================================================================

  async findPoliticianByEmail(email: string): Promise<Politician | null> {
    try {
      // First try exact email match
      const { data: exactMatch, error: exactError } = await this.supabase
        .from('politicians')
        .select('id,name,email,additional_emails')
        .eq('email', email)
        .eq('active', true);

      if (exactError) throw exactError;
      if (exactMatch.length > 0) return exactMatch[0];

      // Then try additional_emails array search
      const { data: arrayMatch, error: arrayError } = await this.supabase
        .from('politicians')
        .select('id,name,email,additional_emails')
        .contains('additional_emails', [email])
        .eq('active', true);

      if (arrayError) throw arrayError;
      return arrayMatch.length > 0 ? arrayMatch[0] : null;
    } catch (error) {
      console.error('Error finding politician:', error);
      return null;
    }
  }

  // =============================================================================
  // CAMPAIGN OPERATIONS
  // =============================================================================

  async findCampaignByHint(hint: string): Promise<Campaign | null> {
    try {
      const { data: campaigns, error } = await this.supabase
        .from('campaigns')
        .select('id,name,slug,status,reference_vector')
        .or(`name.ilike.*${hint}*,slug.ilike.*${hint}*`)
        .in('status', ['active', 'unconfirmed'])
        .limit(1);

      if (error) throw error;
      return campaigns.length > 0 ? campaigns[0] : null;
    } catch (error) {
      console.error('Error finding campaign by hint:', error);
      return null;
    }
  }

  async findSimilarCampaigns(
    embedding: number[],
    limit = 3
  ): Promise<Array<Campaign & { similarity: number }>> {
    try {
      const { data, error } = await this.supabase.rpc('find_similar_campaigns', {
        query_embedding: embedding,
        similarity_threshold: 0.1,
        match_limit: limit,
      });

      if (error) throw error;
      return data;
    } catch (error) {
      console.error('Error finding similar campaigns:', error);

      // Fallback: get all active campaigns without similarity
      const { data: fallback, error: fallbackError } = await this.supabase
        .from('campaigns')
        .select('id,name,slug,status')
        .in('status', ['active', 'unconfirmed'])
        .not('reference_vector', 'is', null)
        .limit(limit);

      if (fallbackError) throw fallbackError;
      return fallback.map(camp => ({ ...camp, similarity: 0.1 }));
    }
  }

  async getUncategorizedCampaign(): Promise<Campaign> {
    try {
      const { data: campaigns, error } = await this.supabase
        .from('campaigns')
        .select('id,name,slug,status')
        .eq('slug', 'uncategorized');

      if (error) throw error;
      if (campaigns.length > 0) return campaigns[0];

      // Create uncategorized campaign
      const { data: newCampaigns, error: createError } = await this.supabase
        .from('campaigns')
        .insert({
          name: 'Uncategorized',
          slug: 'uncategorized',
          description: 'Messages that could not be automatically categorized',
          status: 'active',
          created_by: 'system',
        })
        .select();

      if (createError) throw createError;
      return newCampaigns[0];
    } catch (error) {
      console.error('Error getting uncategorized campaign:', error);
      throw new Error('Failed to get or create uncategorized campaign');
    }
  }

  // =============================================================================
  // MESSAGE OPERATIONS
  // =============================================================================

  async getDuplicateRank(
    senderHash: string,
    politicianId: number,
    campaignId: number
  ): Promise<number> {
    try {
      const { count, error } = await this.supabase
        .from('messages')
        .select('*', { count: 'exact', head: true })
        .eq('sender_hash', senderHash)
        .eq('politician_id', politicianId)
        .eq('campaign_id', campaignId);

      if (error) throw error;
      return count || 0;
    } catch (error) {
      console.error('Error getting duplicate rank:', error);
      return 0;
    }
  }

  async insertMessage(data: MessageInsert): Promise<number> {
    try {
      const { data: result, error } = await this.supabase
        .from('messages')
        .insert(data)
        .select('id');

      if (error) throw error;
      return result[0].id;
    } catch (error) {
      console.error('Error inserting message:', error);
      throw new Error('Failed to store message in database');
    }
  }

  async checkExternalIdExists(externalId: string, channelSource: string): Promise<boolean> {
    try {
      const { data, error } = await this.supabase
        .from('messages')
        .select('id')
        .eq('external_id', externalId)
        .eq('channel_source', channelSource)
        .limit(1);

      if (error) throw error;
      return data.length > 0;
    } catch (error) {
      console.error('Error checking external ID:', error);
      return false;
    }
  }

  // =============================================================================
  // CLASSIFICATION LOGIC
  // =============================================================================

  async classifyMessage(embedding: number[], campaignHint?: string): Promise<ClassificationResult> {
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

      // If similarity is high enough, use existing campaign
      if (best.similarity > 0.7) {
        return {
          campaign_id: best.id,
          campaign_name: best.name,
          confidence: best.similarity,
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
  const encoder = new TextEncoder()
  const data = encoder.encode(email.toLowerCase().trim())
  const hashBuffer = await crypto.subtle.digest('SHA-256', data)
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('')
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
