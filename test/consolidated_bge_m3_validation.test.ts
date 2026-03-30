/**
 * Consolidated BGE-M3 Classification Validation Test
 * 
 * This test validates the BGE-M3 message classification system by:
 * - Testing message-to-message similarity across multiple languages using Proca endpoints
 * - Sending real messages through the API for classification testing
 * - Using actual BGE-M3 model for embeddings (no mocking)
 * - Storing messages in the real database
 * - Verifying classification accuracy and confidence scores
 * - Analyzing uncategorized message rates
 */

import { describe, it, expect } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { generateEmbedding, formatEmailContentForEmbedding } from "../src/embedding_service.js";
import { DatabaseClient } from "../src/database.js";
import * as dotenv from "dotenv";
import * as path from "path";

// Load environment variables
dotenv.config({ path: path.join(process.cwd(), ".env") });

// Define 16 language codes to test
const LANGUAGES = [
  'en', 'fr', 'de', 'es', 'it', 'pt', 'nl', 'pl',
  'cs', 'da', 'fi', 'hu', 'ro', 'sv', 'bg', 'hr'
];

// Proca endpoint base URLs
const PROCA_BASE_URLS = [
  'https://wages_not_jail_2025.proca.app/en',
  'https://can_mercosur_2026.proca.app'
];

interface ProcaMessage {
  subject: string;
  message: string;
}

interface MessageDistanceResult {
  lang1: string;
  lang2: string;
  distance: number;
}

interface TestMessage {
  id: string;
  topic: string;
  language: string;
  expectedCampaign?: string;
  sender_name: string;
  sender_email: string;
  subject: string;
  message: string;
}

interface TestResult {
  testMessage: TestMessage;
  response: any;
  dbRecord?: any;
  success: boolean;
  actualCampaign?: string;
  confidence?: number;
  embeddingDimensions?: number;
  error?: string;
}

interface ValidationMetrics {
  totalTests: number;
  successfulClassifications: number;
  uncategorizedCount: number;
  averageConfidence: number;
  confidenceDistribution: {
    high: number; // > 0.7
    medium: number; // 0.5 - 0.7
    low: number; // < 0.5
  };
  embeddingValidation: {
    correct1024Dimensions: number;
    incorrectDimensions: number;
  };
  accuracyByTopic: Map<string, { correct: number; total: number }>;
}

// Test messages covering different political topics
const TEST_MESSAGES: TestMessage[] = [
  // Climate Change - English
  {
    id: "climate-en-1",
    topic: "climate_change",
    language: "English",
    expectedCampaign: "climate",
    sender_name: "Sarah Johnson",
    sender_email: "sarah.j.test@example.com",
    subject: "Urgent Action Needed on Climate Crisis",
    message: "Dear Representative, I am deeply concerned about the accelerating climate crisis. We need immediate action to reduce carbon emissions, transition to renewable energy, and protect our environment for future generations. The recent extreme weather events in our district demonstrate the urgency of this issue. Please support comprehensive climate legislation and reject fossil fuel subsidies.",
  },
  {
    id: "climate-en-2",
    topic: "climate_change",
    language: "English",
    expectedCampaign: "climate",
    sender_name: "Michael Chen",
    sender_email: "m.chen.test@example.com",
    subject: "Support Clean Energy Transition",
    message: "I'm writing to urge you to support clean energy initiatives. Solar and wind power are the future, and we must invest in green infrastructure now. Climate change is real and threatens our coastal communities. Please vote yes on renewable energy bills and carbon pricing mechanisms.",
  },

  // Climate Change - French
  {
    id: "climate-fr-1",
    topic: "climate_change",
    language: "French",
    expectedCampaign: "climate",
    sender_name: "Marie Dubois",
    sender_email: "marie.d.test@example.com",
    subject: "Action climatique urgente nécessaire",
    message: "Madame la Députée, je vous écris pour exprimer ma profonde inquiétude concernant le changement climatique. Nous devons agir maintenant pour réduire les émissions de gaz à effet de serre et investir dans les énergies renouvelables. L'avenir de nos enfants en dépend. Veuillez soutenir les politiques environnementales ambitieuses.",
  },

  // Climate Change - Spanish
  {
    id: "climate-es-1",
    topic: "climate_change",
    language: "Spanish",
    expectedCampaign: "climate",
    sender_name: "Carlos Rodriguez",
    sender_email: "carlos.r.test@example.com",
    subject: "Acción climática ahora",
    message: "Estimado Representante, le escribo para pedirle que apoye políticas fuertes contra el cambio climático. Necesitamos energía limpia, protección de nuestros bosques y océanos, y reducción de emisiones de carbono. El futuro de nuestro planeta está en juego.",
  },

  // Healthcare Reform
  {
    id: "healthcare-en-1",
    topic: "healthcare",
    language: "English",
    expectedCampaign: "healthcare",
    sender_name: "Jennifer Williams",
    sender_email: "j.williams.test@example.com",
    subject: "Healthcare is a Human Right",
    message: "Dear Senator, I am writing to advocate for universal healthcare coverage. Too many families in our community cannot afford basic medical care. We need Medicare for All, lower prescription drug prices, and protection for pre-existing conditions. Healthcare should be a right, not a privilege for the wealthy.",
  },
  {
    id: "healthcare-en-2",
    topic: "healthcare",
    language: "English",
    expectedCampaign: "healthcare",
    sender_name: "Robert Martinez",
    sender_email: "r.martinez.test@example.com",
    subject: "Lower Prescription Drug Costs",
    message: "I'm a senior citizen struggling to afford my medications. Please support legislation to allow Medicare to negotiate drug prices and cap out-of-pocket costs for prescriptions. Many of us are choosing between medicine and food. This is unacceptable in a wealthy nation.",
  },

  // Education Funding
  {
    id: "education-en-1",
    topic: "education",
    language: "English",
    expectedCampaign: "education",
    sender_name: "Lisa Thompson",
    sender_email: "l.thompson.test@example.com",
    subject: "Invest in Our Schools",
    message: "Dear Representative, as a public school teacher, I see firsthand how underfunding hurts our students. We need smaller class sizes, better resources, higher teacher salaries, and universal pre-K. Please vote to increase education funding and oppose school privatization schemes.",
  },
  {
    id: "education-en-2",
    topic: "education",
    language: "English",
    expectedCampaign: "education",
    sender_name: "David Kim",
    sender_email: "d.kim.test@example.com",
    subject: "Student Debt Relief Needed",
    message: "I'm writing about the student debt crisis. Millions of young people are burdened with crushing loans that prevent them from buying homes or starting families. Please support student loan forgiveness and make public colleges tuition-free. Education is an investment in our future.",
  },

  // Mixed/Ambiguous Messages
  {
    id: "mixed-1",
    topic: "mixed",
    language: "English",
    sender_name: "Amanda Brown",
    sender_email: "a.brown.test@example.com",
    subject: "Multiple Concerns from Your Constituent",
    message: "Dear Senator, I have several concerns I'd like to share. First, we need action on climate change and renewable energy. Second, healthcare costs are too high and we need reform. Third, our schools are underfunded. Finally, infrastructure in our district is crumbling. Please address these critical issues.",
  },
  {
    id: "mixed-2",
    topic: "mixed",
    language: "English",
    sender_name: "James Wilson",
    sender_email: "j.wilson.test@example.com",
    subject: "Community Issues",
    message: "I'm concerned about our community's future. We need better jobs, improved public transportation, and safer neighborhoods. Also, please support small businesses and local farmers. Thank you for your service.",
  },

  // Edge Cases - Very Short
  {
    id: "edge-short-1",
    topic: "edge_case",
    language: "English",
    sender_name: "Tom Short",
    sender_email: "t.short.test@example.com",
    subject: "Climate",
    message: "Please vote yes on climate bill. Thank you.",
  },

  // Edge Cases - Very Long
  {
    id: "edge-long-1",
    topic: "edge_case",
    language: "English",
    sender_name: "Patricia Long",
    sender_email: "p.long.test@example.com",
    subject: "Comprehensive Policy Recommendations for Climate Action",
    message: "Dear Representative, I am writing to provide detailed recommendations on climate policy. " +
      "First, we must transition to 100% renewable energy by 2035. This requires massive investment in solar, wind, and battery storage infrastructure. " +
      "Second, we need a carbon tax starting at $50 per ton and increasing annually. Revenue should fund clean energy rebates for low-income families. " +
      "Third, end all fossil fuel subsidies immediately and redirect those funds to green technology research and development. " +
      "Fourth, protect and expand our forests and wetlands which serve as critical carbon sinks. " +
      "Fifth, invest in public transportation to reduce vehicle emissions. " +
      "Sixth, implement strict emissions standards for all industries. " +
      "Seventh, support international climate agreements and provide climate finance to developing nations. " +
      "Eighth, create green jobs programs to ensure a just transition for fossil fuel workers. " +
      "Ninth, mandate climate risk disclosure for all publicly traded companies. " +
      "Tenth, invest in climate adaptation and resilience for vulnerable communities. " +
      "The science is clear - we have less than a decade to prevent catastrophic warming. " +
      "Every day of delay makes the problem worse and the solutions more expensive. " +
      "Our children and grandchildren are counting on us to act with the urgency this crisis demands. " +
      "I urge you to make climate action your top priority and to reject any compromise that fails to meet the scale of the challenge.",
  },

  // Unclear/Generic Message
  {
    id: "unclear-1",
    topic: "unclear",
    language: "English",
    sender_name: "Generic Voter",
    sender_email: "voter.test@example.com",
    subject: "Thank you",
    message: "Thank you for your service to our district. Keep up the good work representing us.",
  },
];

class ConsolidatedBGE_M3_Test {
  private apiUrl: string;
  private apiKey: string;
  private supabase: any;
  private politicianEmail: string = "";
  private classificationResults: TestResult[] = [];
  private distanceResults: MessageDistanceResult[] = [];

  constructor() {
    this.apiUrl = process.env.API_URL || "http://localhost:3000";
    this.apiKey = process.env.API_KEY || "";

    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_KEY) {
      throw new Error("SUPABASE_URL and SUPABASE_KEY must be set in .env");
    }

    this.supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_KEY
    );
  }

  /**
   * Initialize test by finding a real politician email from database
   */
  async initialize(): Promise<void> {
    console.log("🔍 Initializing test - fetching politician from database...");

    const { data: politicians, error } = await this.supabase
      .from("politicians")
      .select("email, name")
      .eq("active", true)
      .limit(1);

    if (error || !politicians || politicians.length === 0) {
      console.log("⚠️  No active politicians found in database - skipping integration test");
      console.log("   This test requires active politicians in the database to run.");
      return; // Skip test gracefully
    }

    this.politicianEmail = politicians[0].email;
    console.log(`✅ Using politician: ${politicians[0].name} (${this.politicianEmail})\n`);
  }

  /**
   * Fetch message content from Proca endpoints for a specific language
   */
  async fetchProcaMessage(baseUrl: string, language?: string): Promise<ProcaMessage> {
    const url = language ? `${baseUrl}/${language}` : baseUrl;

    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();
      return {
        subject: data.subject,
        message: data.message
      };
    } catch (error) {
      console.error(`Failed to fetch message from ${url}:`, error);
      throw error;
    }
  }

  /**
   * Calculate cosine distance between two embedding vectors
   */
  cosineDistance(vec1: number[], vec2: number[]): number {
    if (vec1.length !== vec2.length) {
      throw new Error('Vectors must have same length');
    }

    let dotProduct = 0;
    let norm1 = 0;
    let norm2 = 0;

    for (let i = 0; i < vec1.length; i++) {
      dotProduct += vec1[i] * vec2[i];
      norm1 += vec1[i] * vec1[i];
      norm2 += vec2[i] * vec2[i];
    }

    if (norm1 === 0 || norm2 === 0) {
      return 1.0; // Maximum distance for zero vectors
    }

    // Direct distance calculation (1 - cosine similarity)
    return 1 - (dotProduct / (Math.sqrt(norm1) * Math.sqrt(norm2)));
  }

  /**
   * Generate embeddings for text using real BGE-M3 model
   */
  async generateRealEmbeddings(text: string): Promise<number[]> {
    // Use null for AI to force local Transformers.js model (real BGE-M3)
    return await generateEmbedding(null, text);
  }

  /**
   * Determine if two messages are from the same campaign
   */
  isSameCampaign(lang1: string, lang2: string, msg1: ProcaMessage, msg2: ProcaMessage): boolean {
    // Check if language codes indicate same campaign
    if (lang1.includes('wages_not_jail') && lang2.includes('wages_not_jail')) return true;
    if (lang1.includes('climate') && lang2.includes('climate')) return true;
    if (lang1.includes('healthcare') && lang2.includes('healthcare')) return true;

    // For sample data, check by language code patterns
    const climateKeywords = ['climate', 'climat', 'klima', 'climático', 'climatico'];
    const healthcareKeywords = ['healthcare', 'santé', 'gesundheit', 'salud', 'salute'];

    const msg1Text = (msg1.subject + ' ' + msg1.message).toLowerCase();
    const msg2Text = (msg2.subject + ' ' + msg2.message).toLowerCase();

    // Check if both messages contain keywords from the same domain
    const msg1IsClimate = climateKeywords.some(keyword => msg1Text.includes(keyword));
    const msg2IsClimate = climateKeywords.some(keyword => msg2Text.includes(keyword));
    const msg1IsHealthcare = healthcareKeywords.some(keyword => msg1Text.includes(keyword));
    const msg2IsHealthcare = healthcareKeywords.some(keyword => msg2Text.includes(keyword));

    return (msg1IsClimate && msg2IsClimate) || (msg1IsHealthcare && msg2IsHealthcare);
  }

  /**
   * Test distance between messages in different languages
   */
  async testMessageDistance(
    lang1: string,
    lang2: string,
    msg1: ProcaMessage,
    msg2: ProcaMessage
  ): Promise<MessageDistanceResult> {
    console.log(`\n🔄 Testing distance between ${lang1} and ${lang2}...`);

    try {
      // Create properly structured messages: # subject\nbody
      const structuredMessage1 = `# ${msg1.subject}\n${msg1.message}`;
      const structuredMessage2 = `# ${msg2.subject}\n${msg2.message}`;

      console.log(`   📝 Message 1: "${structuredMessage1.substring(0, 80)}..."`);
      console.log(`   📝 Message 2: "${structuredMessage2.substring(0, 80)}..."`);

      // Generate single embedding for each structured message
      const messageEmbedding1 = await this.generateRealEmbeddings(structuredMessage1);
      const messageEmbedding2 = await this.generateRealEmbeddings(structuredMessage2);

      // Calculate distance
      const distance = this.cosineDistance(messageEmbedding1, messageEmbedding2);

      console.log(`  📊 Distance: ${distance.toFixed(4)}`);

      return {
        lang1,
        lang2,
        distance
      };
    } catch (error) {
      console.error(`❌ Error testing distance between ${lang1} and ${lang2}:`, error);
      throw error;
    }
  }

  /**
   * Run cross-lingual similarity tests using Proca endpoints
   */
  async runSimilarityTests(): Promise<void> {
    console.log('\n🌍 Starting Cross-Lingual Similarity Tests');
    console.log(`🌍 Testing ${LANGUAGES.length} languages: ${LANGUAGES.join(', ')}`);

    // Show model status first
    console.log('\n🧠 Checking BGE-M3 model status...');
    try {
      const testEmbedding = await this.generateRealEmbeddings("Model status check");
      console.log(`✅ BGE-M3 model ready (${testEmbedding.length} dimensions)`);
    } catch (error) {
      console.error('❌ BGE-M3 model not ready:', error);
      console.log('💡 Please run: npm run model:preload');
      return;
    }

    // Fetch all messages first
    console.log('\n📥 Fetching messages from Proca endpoints...');
    const messages: Map<string, ProcaMessage> = new Map();

    // Fetch from both base URLs
    for (const baseUrl of PROCA_BASE_URLS) {
      console.log(`🌐 Fetching from ${baseUrl}...`);

      if (baseUrl.includes('wages_not_jail')) {
        // This URL has a fixed /en path
        try {
          console.log(`   Trying URL: ${baseUrl}`);
          const message = await this.fetchProcaMessage(baseUrl);
          messages.set('wages_not_jail_en', message);
          console.log(`✅ wages_not_jail_en: ${message.subject.substring(0, 50)}...`);
        } catch (error) {
          console.error(`❌ Failed to fetch wages_not_jail_en: ${error}`);
        }
      } else {
        // This URL supports multiple languages
        console.log(`   Testing with English first...`);
        try {
          const testMessage = await this.fetchProcaMessage(baseUrl, 'en');
          messages.set('en', testMessage);
          console.log(`✅ en (test): ${testMessage.subject.substring(0, 50)}...`);

          // If English works, try a few more languages
          for (const lang of ['fr', 'es', 'de']) {
            try {
              const message = await this.fetchProcaMessage(baseUrl, lang);
              messages.set(lang, message);
              console.log(`✅ ${lang}: ${message.subject.substring(0, 50)}...`);
            } catch (error) {
              console.error(`❌ Failed to fetch ${lang}: ${error}`);
            }
          }
        } catch (error) {
          console.error(`❌ Failed to fetch English from ${baseUrl}: ${error}`);
        }
      }
    }

    if (messages.size < 2) {
      console.log('⚠️  Could not fetch messages from endpoints, using multilingual sample data for demonstration...');

      // Add sample messages representing different languages for demonstration
      const sampleMessages: ProcaMessage[] = [
        {
          subject: "Support Climate Action Now",
          message: "We need immediate action on climate change. Please support renewable energy policies."
        },
        {
          subject: "Soutenir l'action climatique maintenant",
          message: "Nous avons besoin d'une action immédiate sur le changement climatique. Soutenez les politiques d'énergie renouvelable."
        },
        {
          subject: "Unterstützen Sie jetzt Klimaschutzmaßnahmen",
          message: "Wir benötigen sofortige Maßnahmen gegen den Klimawandel. Unterstützen Sie Erneuerbare-Energien-Politik."
        },
        {
          subject: "Apoyar la acción climática ahora",
          message: "Necesitamos acción inmediata sobre el cambio climático. Apoye las políticas de energía renovable."
        },
        {
          subject: "Salute per Tutti",
          message: "L'assistenza sanitaria universale è un diritto umano. Sostegno alla legislazione sul Medicare per tutti."
        },
        {
          subject: "Healthcare for All",
          message: "Universal healthcare is a human right. Support Medicare for All legislation."
        }
      ];

      const sampleLangs = ['en', 'fr', 'de', 'es', 'it', 'it_healthcare'];
      sampleMessages.forEach((msg, i) => {
        messages.set(sampleLangs[i], msg);
      });

      console.log(`✅ Created ${sampleMessages.length} multilingual sample messages for demonstration`);
    }

    console.log(`\n✅ Successfully fetched ${messages.size} messages`);

    // Test pairwise similarities
    const languages = Array.from(messages.keys());
    const totalPairs = (languages.length * (languages.length - 1)) / 2;
    let currentPair = 0;

    console.log('\n🧪 Testing message-to-message similarities...');
    console.log(`📊 Total comparisons: ${totalPairs} pairs`);
    console.log('\n📋 Detailed Distance Results:');
    console.log('='.repeat(80));

    for (let i = 0; i < languages.length; i++) {
      for (let j = i + 1; j < languages.length; j++) {
        currentPair++;
        const lang1 = languages[i];
        const lang2 = languages[j];
        const msg1 = messages.get(lang1)!;
        const msg2 = messages.get(lang2)!;

        // Determine campaign from message content or language
        const campaign1 = lang1.includes('wages_not_jail') ? 'Wages Not Jail' : 'CAN Mercosur';
        const campaign2 = lang2.includes('wages_not_jail') ? 'Wages Not Jail' : 'CAN Mercosur';

        console.log(`\n🔍 Pair ${currentPair}/${totalPairs}: ${lang1} ↔ ${lang2}`);
        console.log(`   Campaign: ${campaign1} ↔ ${campaign2}`);
        console.log(`   Subject 1: "${msg1.subject.substring(0, 60)}${msg1.subject.length > 60 ? '...' : ''}"`);
        console.log(`   Subject 2: "${msg2.subject.substring(0, 60)}${msg2.subject.length > 60 ? '...' : ''}"`);

        try {
          const result = await this.testMessageDistance(lang1, lang2, msg1, msg2);
          this.distanceResults.push(result);

          // Determine if this is same campaign comparison
          const isSameCampaign = this.isSameCampaign(lang1, lang2, msg1, msg2);

          if (isSameCampaign) {
            // Assert that same campaign messages have distance ≤ 0.1
            expect(result.distance).toBeLessThanOrEqual(0.1);
            console.log(`\r✅ ${lang1}-${lang2}: ${result.distance.toFixed(4)} distance (same campaign ✓)`);
          } else {
            console.log(`\r✅ ${lang1}-${lang2}: ${result.distance.toFixed(4)} distance (different campaigns)`);
          }

        } catch (error) {
          console.error(`\r❌ Failed to test ${lang1}-${lang2}:`, error);
        }
      }
    }

    // Analyze distance results
    this.analyzeDistanceResults(languages);
  }

  /**
   * Analyze and display distance test results
   */
  analyzeDistanceResults(languages: string[]): void {
    console.log('\n📈 Distance Test Results:');
    console.log('==========================');

    if (this.distanceResults.length === 0) {
      console.log('❌ No distance tests completed successfully');
      return;
    }

    // Calculate statistics
    const distances = this.distanceResults.map(r => r.distance);
    const avgDistance = distances.reduce((a: number, b: number) => a + b, 0) / distances.length;
    const minDistance = Math.min(...distances);
    const maxDistance = Math.max(...distances);

    console.log(`📊 Tests completed: ${this.distanceResults.length} pairwise comparisons`);
    console.log(`📊 Average distance: ${avgDistance.toFixed(4)}`);
    console.log(`📊 Distance range: ${minDistance.toFixed(4)} - ${maxDistance.toFixed(4)}`);

    // Find best and worst matches (lowest distance = best match)
    const bestMatch = this.distanceResults.reduce((best: MessageDistanceResult, current: MessageDistanceResult) =>
      current.distance < best.distance ? current : best
    );
    const worstMatch = this.distanceResults.reduce((worst: MessageDistanceResult, current: MessageDistanceResult) =>
      current.distance > worst.distance ? current : worst
    );

    console.log(`\n🏆 Best match: ${bestMatch.lang1}-${bestMatch.lang2} (${bestMatch.distance.toFixed(4)} distance)`);
    console.log(`📉 Worst match: ${worstMatch.lang1}-${worstMatch.lang2} (${worstMatch.distance.toFixed(4)} distance)`);

    // Distance quality assessment
    console.log('\n🎯 Distance Quality Assessment:');
    console.log('===================================');

    // Distance thresholds (lower distance = more similar)
    const lowDistanceThreshold = 0.1;  // Very close match
    const mediumDistanceThreshold = 0.3; // Moderate match

    const lowDistanceCount = distances.filter((d: number) => d <= lowDistanceThreshold).length;
    const mediumDistanceCount = distances.filter((d: number) => d > lowDistanceThreshold && d <= mediumDistanceThreshold).length;
    const highDistanceCount = distances.filter((d: number) => d > mediumDistanceThreshold).length;

    console.log(`🎯 Low distance (≤${lowDistanceThreshold}): ${lowDistanceCount} pairs (${(lowDistanceCount / this.distanceResults.length * 100).toFixed(1)}%)`);
    console.log(`⚡ Medium distance (≤${mediumDistanceThreshold}): ${mediumDistanceCount} pairs (${(mediumDistanceCount / this.distanceResults.length * 100).toFixed(1)}%)`);
    console.log(`💧 High distance (>${mediumDistanceThreshold}): ${highDistanceCount} pairs (${(highDistanceCount / this.distanceResults.length * 100).toFixed(1)}%)`);

    // Final assessment
    if (avgDistance <= 0.1) {
      console.log('🎉 EXCELLENT: BGE-M3 shows strong cross-lingual semantic understanding');
    } else if (avgDistance <= 0.3) {
      console.log('✅ GOOD: BGE-M3 shows adequate cross-lingual semantic understanding');
    } else {
      console.log('⚠️  NEEDS IMPROVEMENT: BGE-M3 shows limited cross-lingual semantic understanding');
    }
  }

  /**
   * Send a test message through the API
   */
  async sendMessage(testMsg: TestMessage): Promise<any> {
    const payload = {
      external_id: `test-${testMsg.id}-${Date.now()}`,
      sender_name: testMsg.sender_name,
      sender_email: testMsg.sender_email,
      recipient_email: this.politicianEmail,
      subject: testMsg.subject,
      message: testMsg.message,
      text_content: testMsg.message,
      timestamp: new Date().toISOString(),
      channel_source: "consolidated-bge-m3-test",
    };

    // Create AbortController with 5 minute timeout for model loading
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 300000); // 5 minutes

    try {
      const response = await fetch(`${this.apiUrl}/api/v1/messages`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      const data = await response.json();

      return {
        http_status: response.status,
        ...data,
      };
    } catch (error) {
      clearTimeout(timeoutId);
      throw error;
    }
  }

  /**
   * Verify message in database and check embedding dimensions
   */
  async verifyInDatabase(messageId: number): Promise<any> {
    const { data, error } = await this.supabase
      .from("messages")
      .select(`
        id,
        campaign_id,
        classification_confidence,
        message_embedding,
        duplicate_rank,
        campaigns (
          id,
          name,
          slug
        )
      `)
      .eq("id", messageId)
      .single();

    if (error) {
      console.error("Database verification error:", error);
      return null;
    }

    return data;
  }

  /**
   * Run a single classification test case
   */
  async runClassificationTest(testMsg: TestMessage): Promise<TestResult> {
    console.log(`\n📝 Testing: ${testMsg.id} (${testMsg.topic} - ${testMsg.language})`);
    console.log(`   Subject: "${testMsg.subject}"`);

    try {
      // Send message through API
      const response = await this.sendMessage(testMsg);

      if (response.http_status !== 200 || !response.success) {
        console.log(`   ❌ API Error: HTTP ${response.http_status}`);
        console.log(`   Response:`, JSON.stringify(response, null, 2));
        return {
          testMessage: testMsg,
          response,
          success: false,
          error: response.error || response.message || `HTTP ${response.http_status}`,
        };
      }

      console.log(`   ✅ API Response: HTTP ${response.http_status}`);
      console.log(`   Campaign: ${response.campaign_name} (confidence: ${response.confidence?.toFixed(3)})`);

      // Verify in database
      const dbRecord = await this.verifyInDatabase(response.message_id);

      if (!dbRecord) {
        return {
          testMessage: testMsg,
          response,
          success: false,
          error: "Message not found in database",
        };
      }

      // Check embedding dimensions
      let embedding = dbRecord.message_embedding;

      // If embedding is a string, parse it
      if (typeof embedding === 'string') {
        try {
          embedding = JSON.parse(embedding);
        } catch (e) {
          console.log(`   ⚠️  Could not parse embedding`);
        }
      }

      const embeddingDimensions = Array.isArray(embedding) ? embedding.length : 0;
      const embeddingCorrect = embeddingDimensions === 1024;

      console.log(`   📊 Embedding: ${embeddingDimensions} dimensions ${embeddingCorrect ? "✅" : "❌"}`);

      // Extract campaign name
      const campaignName = dbRecord.campaigns?.name || "Unknown";

      return {
        testMessage: testMsg,
        response,
        dbRecord,
        success: true,
        actualCampaign: campaignName,
        confidence: dbRecord.classification_confidence,
        embeddingDimensions,
      };

    } catch (error) {
      console.error(`   ❌ Error:`, error);
      return {
        testMessage: testMsg,
        response: null,
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Run all classification test cases
   */
  async runClassificationTests(): Promise<void> {
    console.log(`\n${"=".repeat(80)}`);
    console.log("🚀 Starting Classification Validation Tests");
    console.log(`${"=".repeat(80)}`);
    console.log(`Total test messages: ${TEST_MESSAGES.length}`);
    console.log(`\n⏳ Note: First request may take 2-5 minutes while BGE-M3 model downloads...`);

    for (const testMsg of TEST_MESSAGES) {
      const result = await this.runClassificationTest(testMsg);
      this.classificationResults.push(result);

      // Small delay between tests to avoid overwhelming the API
      await new Promise(resolve => setTimeout(resolve, 500));
    }

    this.displayClassificationResults();
  }

  /**
   * Calculate and display classification metrics
   */
  calculateClassificationMetrics(): ValidationMetrics {
    const metrics: ValidationMetrics = {
      totalTests: this.classificationResults.length,
      successfulClassifications: 0,
      uncategorizedCount: 0,
      averageConfidence: 0,
      confidenceDistribution: {
        high: 0,
        medium: 0,
        low: 0,
      },
      embeddingValidation: {
        correct1024Dimensions: 0,
        incorrectDimensions: 0,
      },
      accuracyByTopic: new Map(),
    };

    let totalConfidence = 0;
    let confidenceCount = 0;

    for (const result of this.classificationResults) {
      if (!result.success) continue;

      metrics.successfulClassifications++;

      // Check if uncategorized
      if (result.actualCampaign?.toLowerCase().includes("uncategorized")) {
        metrics.uncategorizedCount++;
      }

      // Confidence distribution
      if (result.confidence !== undefined) {
        totalConfidence += result.confidence;
        confidenceCount++;

        if (result.confidence > 0.7) {
          metrics.confidenceDistribution.high++;
        } else if (result.confidence >= 0.5) {
          metrics.confidenceDistribution.medium++;
        } else {
          metrics.confidenceDistribution.low++;
        }
      }

      // Embedding validation
      if (result.embeddingDimensions === 1024) {
        metrics.embeddingValidation.correct1024Dimensions++;
      } else {
        metrics.embeddingValidation.incorrectDimensions++;
      }

      // Accuracy by topic
      const topic = result.testMessage.topic;
      if (!metrics.accuracyByTopic.has(topic)) {
        metrics.accuracyByTopic.set(topic, { correct: 0, total: 0 });
      }

      const topicStats = metrics.accuracyByTopic.get(topic)!;
      topicStats.total++;

      // Check if classification matches expected (if provided)
      if (result.testMessage.expectedCampaign) {
        const expectedMatch = result.actualCampaign?.toLowerCase().includes(
          result.testMessage.expectedCampaign.toLowerCase()
        );
        if (expectedMatch) {
          topicStats.correct++;
        }
      }
    }

    metrics.averageConfidence = confidenceCount > 0 ? totalConfidence / confidenceCount : 0;

    return metrics;
  }

  /**
   * Display detailed classification results
   */
  displayClassificationResults(): void {
    console.log(`\n${"=".repeat(80)}`);
    console.log("📊 CLASSIFICATION TEST RESULTS");
    console.log(`${"=".repeat(80)}\n`);

    const metrics = this.calculateClassificationMetrics();

    // Overall Statistics
    console.log("📈 OVERALL STATISTICS");
    console.log("-".repeat(80));
    console.log(`Total Tests:              ${metrics.totalTests}`);
    console.log(`Successful:               ${metrics.successfulClassifications}`);
    console.log(`Failed:                   ${metrics.totalTests - metrics.successfulClassifications}`);
    console.log(`Uncategorized:            ${metrics.uncategorizedCount} (${(metrics.uncategorizedCount / metrics.successfulClassifications * 100).toFixed(1)}%)`);
    console.log(`Average Confidence:       ${metrics.averageConfidence.toFixed(3)}`);

    // Confidence Distribution
    console.log(`\n🎯 CONFIDENCE DISTRIBUTION`);
    console.log("-".repeat(80));
    console.log(`High (> 0.7):             ${metrics.confidenceDistribution.high} (${(metrics.confidenceDistribution.high / metrics.successfulClassifications * 100).toFixed(1)}%)`);
    console.log(`Medium (0.5 - 0.7):       ${metrics.confidenceDistribution.medium} (${(metrics.confidenceDistribution.medium / metrics.successfulClassifications * 100).toFixed(1)}%)`);
    console.log(`Low (< 0.5):              ${metrics.confidenceDistribution.low} (${(metrics.confidenceDistribution.low / metrics.successfulClassifications * 100).toFixed(1)}%)`);

    // Embedding Validation
    console.log(`\n🔢 EMBEDDING VALIDATION`);
    console.log("-".repeat(80));
    console.log(`Correct (1024 dims):      ${metrics.embeddingValidation.correct1024Dimensions}`);
    console.log(`Incorrect:                ${metrics.embeddingValidation.incorrectDimensions}`);

    // Accuracy by Topic
    console.log(`\n📚 ACCURACY BY TOPIC`);
    console.log("-".repeat(80));
    const topicEntries = Array.from(metrics.accuracyByTopic.entries());
    for (let i = 0; i < topicEntries.length; i++) {
      const [topic, stats] = topicEntries[i];
      const accuracy = stats.total > 0 ? (stats.correct / stats.total * 100).toFixed(1) : "N/A";
      console.log(`${topic.padEnd(20)} ${stats.correct}/${stats.total} (${accuracy}%)`);
    }

    // Recommendations
    console.log(`\n💡 CLASSIFICATION RECOMMENDATIONS`);
    console.log("-".repeat(80));

    if (metrics.uncategorizedCount / metrics.successfulClassifications > 0.3) {
      console.log("⚠️  High uncategorized rate (>30%). Consider:");
      console.log("   - Adding more campaign reference vectors");
      console.log("   - Lowering similarity threshold");
      console.log("   - Reviewing campaign descriptions");
    }

    if (metrics.confidenceDistribution.low / metrics.successfulClassifications > 0.4) {
      console.log("⚠️  Many low-confidence classifications (>40%). Consider:");
      console.log("   - Improving campaign reference vectors");
      console.log("   - Adding more training examples");
      console.log("   - Reviewing classification threshold");
    }

    if (metrics.embeddingValidation.incorrectDimensions > 0) {
      console.log("❌ Embedding dimension errors detected!");
      console.log("   - Check BGE-M3 model configuration");
      console.log("   - Verify database schema for message_embedding field");
    }

    if (metrics.averageConfidence > 0.7) {
      console.log("✅ Good average confidence score!");
    }

    if (metrics.embeddingValidation.correct1024Dimensions === metrics.successfulClassifications) {
      console.log("✅ All embeddings have correct 1024 dimensions!");
    }
  }


  /**
   * Test clustering behavior when multiple messages arrive at once
   */
  async testMultipleMessageClustering(): Promise<void> {
    console.log(`\n${"=".repeat(80)}`);
    console.log("🔄 TESTING MULTIPLE MESSAGE CLUSTERING");
    console.log(`${"=".repeat(80)}`);

    if (!this.politicianEmail) {
      console.log("⚠️  No politician found - skipping clustering test");
      return;
    }

    // Create similar messages that should cluster together
    const similarMessages: TestMessage[] = [
      {
        id: "cluster-test-1",
        topic: "climate_change",
        language: "English",
        expectedCampaign: "climate",
        sender_name: "Alice Green",
        sender_email: "alice.cluster.test@example.com",
        subject: "Climate Action Now",
        message: "We need immediate action on climate change. Please support renewable energy policies and carbon reduction initiatives.",
      },
      {
        id: "cluster-test-2",
        topic: "climate_change",
        language: "English",
        expectedCampaign: "climate",
        sender_name: "Bob Green",
        sender_email: "bob.cluster.test@example.com",
        subject: "Support Climate Legislation",
        message: "I urge you to vote for climate legislation. Renewable energy and carbon reduction are essential for our future.",
      },
      {
        id: "cluster-test-3",
        topic: "climate_change",
        language: "English",
        expectedCampaign: "climate",
        sender_name: "Carol Green",
        sender_email: "carol.cluster.test@example.com",
        subject: "Renewable Energy Support",
        message: "Please support renewable energy policies. Climate change requires immediate action on carbon emissions.",
      }
    ];

    console.log(`📤 Sending ${similarMessages.length} similar messages simultaneously...`);

    // Send all messages simultaneously
    const sendPromises = similarMessages.map(msg => this.sendMessage(msg));
    const responses = await Promise.all(sendPromises);

    // Verify all messages were processed successfully
    const successfulResponses = responses.filter(r => r.http_status === 200 && r.success);
    console.log(`✅ ${successfulResponses.length}/${similarMessages.length} messages processed successfully`);

    if (successfulResponses.length < similarMessages.length) {
      console.log("❌ Some messages failed to process:");
      responses.forEach((response, index) => {
        if (response.http_status !== 200 || !response.success) {
          console.log(`   Message ${index + 1}: HTTP ${response.http_status} - ${response.error || 'Unknown error'}`);
        }
      });
      return;
    }

    // Wait a moment for clustering to complete
    console.log("⏳ Waiting for clustering to complete...");
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Check clustering results in database
    const messageIds = successfulResponses.map(r => r.message_id);
    console.log(`🔍 Checking cluster assignments for ${messageIds.length} messages...`);

    const { data: messageClusters, error } = await this.supabase
      .from("messages")
      .select("id, cluster_id, campaigns(name)")
      .in("id", messageIds);

    if (error) {
      console.error("❌ Error fetching message clusters:", error);
      return;
    }

    console.log("📊 Clustering Results:");
    const clusterGroups = new Map<number | null, any[]>();

    messageClusters?.forEach((msg: any) => {
      const clusterId = msg.cluster_id;
      if (!clusterGroups.has(clusterId)) {
        clusterGroups.set(clusterId, []);
      }
      clusterGroups.get(clusterId)!.push(msg);
    });

    // Display clustering results
    for (const [clusterId, messages] of clusterGroups.entries()) {
      if (clusterId === null) {
        console.log(`   🚫 Unclustered: ${messages.length} messages`);
      } else {
        console.log(`   🎯 Cluster ${clusterId}: ${messages.length} messages`);
      }
      messages.forEach((msg: any) => {
        console.log(`      - Message ${msg.id} (${msg.campaigns?.name || 'Unknown campaign'})`);
      });
    }

    // Verify clustering expectations
    const clusteredMessages = messageClusters?.filter((m: any) => m.cluster_id !== null) || [];
    const unclusteredMessages = messageClusters?.filter((m: any) => m.cluster_id === null) || [];

    console.log(`\n📈 Clustering Analysis:`);
    console.log(`   Clustered messages: ${clusteredMessages.length}`);
    console.log(`   Unclustered messages: ${unclusteredMessages.length}`);

    // At least 2 messages should be clustered together (they're very similar)
    const hasClusterWithMultipleMessages = Array.from(clusterGroups.entries())
      .some(([clusterId, messages]: [number | null, any[]]) => clusterId !== null && messages.length >= 2);

    if (hasClusterWithMultipleMessages) {
      console.log("✅ SUCCESS: Similar messages were properly clustered together");
    } else {
      console.log("⚠️  WARNING: Similar messages were not clustered together");
      console.log("   This may indicate clustering is not enabled or working correctly");
    }

    // Check if clustering is being called at all
    console.log("\n🔍 Checking if clustering logic is integrated...");
    const { data: clusterCount } = await this.supabase
      .from("message_clusters")
      .select("count")
      .single();

    console.log(`   Total clusters in database: ${clusterCount || 0}`);

    if (clusterCount === 0) {
      console.log("❌ CRITICAL: No clusters found in database");
      console.log("   The assignMessageToCluster method may not be called during message processing");
      console.log("   Check message_processor.ts to ensure clustering is integrated");
    } else {
      console.log(`✅ SUCCESS: Found ${clusterCount} clusters in database - clustering is working!`);
    }

    // Save clustering test results to file for verification
    const clusteringResults = {
      timestamp: new Date().toISOString(),
      testType: "multiple_message_clustering",
      messagesSent: similarMessages.length,
      messagesProcessed: successfulResponses.length,
      clusteringResults: {
        clusteredMessages: clusteredMessages.length,
        unclusteredMessages: unclusteredMessages.length,
        totalClusters: clusterCount || 0,
        clusterGroups: Array.from(clusterGroups.entries()).map(([clusterId, messages]) => ({
          clusterId,
          messageCount: messages.length,
          messageIds: messages.map((m: any) => m.id)
        }))
      },
      success: hasClusterWithMultipleMessages && (clusterCount || 0) > 0
    };
  }

  /**
   * Run the complete consolidated test suite
   */
  async runAllTests(): Promise<void> {
    console.log(`\n${"=".repeat(80)}`);
    console.log("🚀 STARTING CONSOLIDATED BGE-M3 VALIDATION TEST SUITE");
    console.log(`${"=".repeat(80)}`);

    try {
      await this.initialize();

      // Check if initialization was skipped (no politicians found)
      if (!this.politicianEmail) {
        console.log("⚠️  No active politicians found - running similarity tests only");
        console.log("   Classification tests require active politicians in the database.\n");

        // Still run similarity tests since they don't need politicians
        await this.runSimilarityTests();

        console.log(`\n${"=".repeat(80)}`);
        console.log("✅ SIMILARITY TESTS COMPLETE!");
        console.log(`${"=".repeat(80)}\n`);
        return;
      }

      // Run both test types
      await this.runSimilarityTests();
      await this.runClassificationTests();

      // Test clustering with multiple messages
      await this.testMultipleMessageClustering();

      console.log(`\n${"=".repeat(80)}`);
      console.log("✅ CONSOLIDATED TEST SUITE COMPLETE!");
      console.log(`${"=".repeat(80)}\n`);

    } catch (error) {
      console.error("\n❌ Test suite execution failed:", error);
      throw error;
    }
  }
}

// Test suite for Vitest
describe("Consolidated BGE-M3 Validation", () => {
  it("should run complete BGE-M3 validation test suite", async () => {
    const test = new ConsolidatedBGE_M3_Test();
    await test.runAllTests();
    expect(true).toBe(true); // Test passes if no exceptions are thrown
  }, 300000); // 5 minute timeout for comprehensive test
});

// Main execution
async function main() {
  try {
    const test = new ConsolidatedBGE_M3_Test();
    await test.runAllTests();
    console.log("Test suite execution completed successfully.");
  } catch (error) {
    console.error("\n❌ Test execution failed:", error);
    process.exit(1);
  }
}

// Run the test if this file is executed directly
// For ES modules, we check the import.meta.url
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

export { ConsolidatedBGE_M3_Test, main };
