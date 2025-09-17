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
  private baseUrl: string
  private apiKey: string

  constructor(config: SupabaseConfig) {
    this.baseUrl = `${config.url}/rest/v1`
    this.apiKey = config.key
  }

  private async request<T>(
    endpoint: string, 
    options: RequestInit = {}
  ): Promise<T> {
    const url = `${this.baseUrl}${endpoint}`
    
    const response = await fetch(url, {
      ...options,
      headers: {
        'apikey': this.apiKey,
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=representation',
        ...options.headers,
      },
    })

    if (!response.ok) {
      const error = await response.text()
      throw new Error(`Database error: ${response.status} - ${error}`)
    }

    return response.json()
  }

  // =============================================================================
  // POLITICIAN OPERATIONS
  // =============================================================================

  async findPoliticianByEmail(email: string): Promise<Politician | null> {
    try {
      // First try exact email match
      const exactMatch = await this.request<Politician[]>(
        `/politicians?email=eq.${encodeURIComponent(email)}&active=eq.true&select=id,name,email,additional_emails`
      )

      if (exactMatch.length > 0) {
        return exactMatch[0]
      }

      // Then try additional_emails array search using PostgREST array operators
      const arrayMatch = await this.request<Politician[]>(
        `/politicians?additional_emails=cs.{${encodeURIComponent(email)}}&active=eq.true&select=id,name,email,additional_emails`
      )

      return arrayMatch.length > 0 ? arrayMatch[0] : null

    } catch (error) {
      console.error('Error finding politician:', error)
      return null
    }
  }

  // =============================================================================
  // CAMPAIGN OPERATIONS
  // =============================================================================

  async findCampaignByHint(hint: string): Promise<Campaign | null> {
    try {
      const campaigns = await this.request<Campaign[]>(
        `/campaigns?or=(name.ilike.*${encodeURIComponent(hint)}*,slug.ilike.*${encodeURIComponent(hint)}*)&status=in.(active,unconfirmed)&select=id,name,slug,status,reference_vector&limit=1`
      )

      return campaigns.length > 0 ? campaigns[0] : null
    } catch (error) {
      console.error('Error finding campaign by hint:', error)
      return null
    }
  }

  async findSimilarCampaigns(embedding: number[], limit = 3): Promise<Array<Campaign & { similarity: number }>> {
    try {
      // Use PostgREST RPC call for vector similarity
      const result = await this.request<Array<Campaign & { similarity: number }>>(
        '/rpc/find_similar_campaigns',
        {
          method: 'POST',
          body: JSON.stringify({
            query_embedding: embedding,
            similarity_threshold: 0.1,
            match_limit: limit
          })
        }
      )

      return result
    } catch (error) {
      console.error('Error finding similar campaigns:', error)
      
      // Fallback: get all active campaigns without similarity
      const fallback = await this.request<Campaign[]>(
        `/campaigns?status=in.(active,unconfirmed)&reference_vector=not.is.null&select=id,name,slug,status&limit=${limit}`
      )
      
      return fallback.map(camp => ({ ...camp, similarity: 0.1 }))
    }
  }

  async getUncategorizedCampaign(): Promise<Campaign> {
    try {
      const campaigns = await this.request<Campaign[]>(
        `/campaigns?slug=eq.uncategorized&select=id,name,slug,status`
      )

      if (campaigns.length > 0) {
        return campaigns[0]
      }

      // Create uncategorized campaign
      const newCampaigns = await this.request<Campaign[]>(
        '/campaigns',
        {
          method: 'POST',
          body: JSON.stringify({
            name: 'Uncategorized',
            slug: 'uncategorized',
            description: 'Messages that could not be automatically categorized',
            status: 'active',
            created_by: 'system'
          })
        }
      )

      return newCampaigns[0]
    } catch (error) {
      console.error('Error getting uncategorized campaign:', error)
      throw new Error('Failed to get or create uncategorized campaign')
    }
  }

  // =============================================================================
  // MESSAGE OPERATIONS
  // =============================================================================

  async getDuplicateRank(senderHash: string, politicianId: number, campaignId: number): Promise<number> {
    try {
      const result = await this.request<Array<{ count: number }>>(
        `/messages?sender_hash=eq.${senderHash}&politician_id=eq.${politicianId}&campaign_id=eq.${campaignId}&select=count()`,
        {
          headers: {
            'Prefer': 'count=exact'
          }
        }
      )

      // PostgREST count response format
      return parseInt(result[0]?.count?.toString() || '0')
    } catch (error) {
      console.error('Error getting duplicate rank:', error)
      return 0
    }
  }

  async insertMessage(data: MessageInsert): Promise<number> {
    try {
      const result = await this.request<Array<{ id: number }>>(
        '/messages',
        {
          method: 'POST',
          body: JSON.stringify({
            ...data,
            message_embedding: JSON.stringify(data.message_embedding) // Convert array to JSON string for PostgreSQL
          })
        }
      )

      return result[0].id
    } catch (error) {
      console.error('Error inserting message:', error)
      throw new Error('Failed to store message in database')
    }
  }

  async checkExternalIdExists(externalId: string, channelSource: string): Promise<boolean> {
    try {
      const result = await this.request<Array<{ id: number }>>(
        `/messages?external_id=eq.${encodeURIComponent(externalId)}&channel_source=eq.${encodeURIComponent(channelSource)}&select=id&limit=1`
      )

      return result.length > 0
    } catch (error) {
      console.error('Error checking external ID:', error)
      return false
    }
  }

  // =============================================================================
  // CLASSIFICATION LOGIC
  // =============================================================================

  async classifyMessage(embedding: number[], campaignHint?: string): Promise<ClassificationResult> {
    // Step 1: Try campaign hint if provided
    if (campaignHint) {
      const hintCampaign = await this.findCampaignByHint(campaignHint)
      if (hintCampaign) {
        return {
          campaign_id: hintCampaign.id,
          campaign_name: hintCampaign.name,
          confidence: 0.95
        }
      }
    }

    // Step 2: Try vector similarity
    const similarCampaigns = await this.findSimilarCampaigns(embedding, 3)
    
    if (similarCampaigns.length > 0) {
      const best = similarCampaigns[0]
      
      // If similarity is high enough, use existing campaign
      if (best.similarity > 0.7) {
        return {
          campaign_id: best.id,
          campaign_name: best.name,
          confidence: best.similarity
        }
      }
    }

    // Step 3: Fall back to uncategorized
    const uncategorized = await this.getUncategorizedCampaign()
    
    return {
      campaign_id: uncategorized.id,
      campaign_name: uncategorized.name,
      confidence: 0.1
    }
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
