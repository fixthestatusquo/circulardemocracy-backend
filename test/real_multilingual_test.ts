/**
 * Real Multilingual CAN Mercosur 2026 Classification Test
 * Uses actual BGE-M3 model (not mocked) to generate real embeddings
 * Run with: npx tsx test/real_multilingual_test.ts
 */

import dotenv from "dotenv";
dotenv.config();

import { processMessage } from "../src/message_processor";
import { DatabaseClient } from "../src/database";

export interface CampaignMessage {
  subject: string;
  message: string;
  language?: string;
  expected_campaign: string;
}

export interface CampaignTestData {
  campaign_name: string;
  messages: CampaignMessage[];
}

export interface TestConfig {
  campaigns: CampaignTestData[];
  confidence_threshold?: number;
}

// Real database connection with only politician lookup mocked
const createRealDb = (): DatabaseClient => {
  const realDb = new DatabaseClient({
    url: process.env.SUPABASE_URL || "",
    key: process.env.SUPABASE_KEY || ""
  });

  // Mock only the politician lookup to avoid "no politician found" errors
  const originalFindPoliticianByEmail = realDb.findPoliticianByEmail.bind(realDb);
  realDb.findPoliticianByEmail = async (email: string) => {
    // Return a mock politician for any email
    return {
      id: 1,
      name: "Test Politician",
      email: email,
      additional_emails: [],
      active: true,
      party: "Test Party",
      country: "EU",
      region: "Europe",
      level: "european",
      position: "MEP"
    };
  };

  return realDb;
};

// Real Ai - use actual embedding service
const realAi = null; // Let the embedding service use the real BGE-M3 model

/**
 * Real campaign classification tester using actual BGE-M3 embeddings
 */
export class RealCampaignClassificationTester {
  private config: TestConfig;
  private realDb: DatabaseClient;

  constructor(config: TestConfig) {
    this.config = config;
    this.realDb = createRealDb();
  }

  async testAllCampaigns(): Promise<TestResults> {
    console.log(`🧪 Testing ${this.config.campaigns.length} campaigns with REAL BGE-M3 embeddings...\n`);

    const results: CampaignResult[] = [];

    for (const campaign of this.config.campaigns) {
      const campaignResult = await this.testCampaign(campaign);
      results.push(campaignResult);
    }

    return new TestResults(results, this.config.confidence_threshold || 0.7);
  }

  async testCampaign(campaign: CampaignTestData): Promise<CampaignResult> {
    console.log(`📝 Testing campaign: ${campaign.campaign_name}`);
    console.log(`   Messages: ${campaign.messages.length}`);

    const messageResults: MessageResult[] = [];

    for (let i = 0; i < campaign.messages.length; i++) {
      const messageData = campaign.messages[i];
      const messageResult = await this.testMessage(messageData, campaign.campaign_name, i);
      messageResults.push(messageResult);
    }

    const campaignResult = new CampaignResult(campaign.campaign_name, messageResults);
    console.log(`   ✅ ${campaignResult.successful}/${campaignResult.total} messages classified correctly\n`);

    return campaignResult;
  }

  async testMessage(messageData: CampaignMessage, campaignName: string, index: number): Promise<MessageResult> {
    const messageInput = {
      external_id: `test-${messageData.expected_campaign}-${index}-${Date.now()}`,
      sender_name: "Test Citizen",
      sender_email: "test@example.com",
      recipient_email: "test@example.com",
      subject: messageData.subject,
      message: messageData.message,
      timestamp: new Date().toISOString(),
      channel_source: "test",
    };

    try {
      console.log(`   🔄 Processing ${messageData.language?.toUpperCase()} message with real BGE-M3...`);
      const result = await processMessage(this.realDb, realAi as any, messageInput);

      const success = result.campaign_name === messageData.expected_campaign &&
        (result.confidence || 0) >= (this.config.confidence_threshold || 0.7);

      console.log(`   ✅ ${messageData.language?.toUpperCase()}: ${result.confidence?.toFixed(3)} confidence → ${result.campaign_name}`);

      // Debug: show if it's using similarity or fallback
      if (result.campaign_name === "Uncategorized") {
        console.log(`      📊 Using fallback (similarity below threshold)`);
      } else {
        console.log(`      📊 Using vector similarity match`);
      }

      return new MessageResult(
        messageData.expected_campaign,
        result.campaign_name || "unknown",
        result.confidence || 0,
        success,
        messageData.language || "unknown"
      );

    } catch (error) {
      console.log(`   ❌ ${messageData.language?.toUpperCase()}: Error - ${error instanceof Error ? error.message : String(error)}`);
      return new MessageResult(
        messageData.expected_campaign,
        "error",
        0,
        false,
        messageData.language || "unknown",
        error instanceof Error ? error.message : String(error)
      );
    }
  }
}

export class MessageResult {
  constructor(
    public expected_campaign: string,
    public actual_campaign: string,
    public confidence: number,
    public success: boolean,
    public language: string,
    public error?: string
  ) { }
}

export class CampaignResult {
  public successful: number;
  public total: number;
  public confidence_scores: number[];

  constructor(
    public campaign_name: string,
    public message_results: MessageResult[]
  ) {
    this.successful = message_results.filter(r => r.success).length;
    this.total = message_results.length;
    this.confidence_scores = message_results.map(r => r.confidence);
  }

  get success_rate(): number {
    return this.total > 0 ? this.successful / this.total : 0;
  }

  get avg_confidence(): number {
    return this.confidence_scores.length > 0
      ? this.confidence_scores.reduce((a, b) => a + b, 0) / this.confidence_scores.length
      : 0;
  }
}

export class TestResults {
  public successful_campaigns: number;
  public total_campaigns: number;
  public successful_messages: number;
  public total_messages: number;

  constructor(
    public campaign_results: CampaignResult[],
    private confidence_threshold: number
  ) {
    this.successful_campaigns = campaign_results.filter(r => r.success_rate === 1).length;
    this.total_campaigns = campaign_results.length;
    this.successful_messages = campaign_results.reduce((sum, r) => sum + r.successful, 0);
    this.total_messages = campaign_results.reduce((sum, r) => sum + r.total, 0);
  }

  printSummary(): void {
    console.log("📊 Real BGE-M3 Test Results Summary");
    console.log("===================================");
    console.log(`✅ Campaigns: ${this.successful_campaigns}/${this.total_campaigns} successful`);
    console.log(`✅ Messages: ${this.successful_messages}/${this.total_messages} successful`);
    console.log(`📈 Overall Success Rate: ${((this.successful_messages / this.total_messages) * 100).toFixed(1)}%`);

    console.log("\n📈 Campaign Details:");
    this.campaign_results.forEach(result => {
      const status = result.success_rate === 1 ? "✅" : "⚠️";
      console.log(`   ${status} ${result.campaign_name}: ${result.successful}/${result.total} (${(result.success_rate * 100).toFixed(1)}%)`);
      console.log(`      Avg Confidence: ${result.avg_confidence.toFixed(3)}`);

      // Show individual confidences
      console.log(`      Individual confidences: ${result.message_results.map(m => `${m.language}(${m.confidence.toFixed(3)})`).join(', ')}`);

      const failed = result.message_results.filter(r => !r.success);
      if (failed.length > 0) {
        console.log(`      ❌ Failed messages: ${failed.map(f => `${f.language}(${f.actual_campaign})`).join(", ")}`);
      }
    });

    console.log(`\n🎯 Confidence Threshold: ${this.confidence_threshold}`);
    console.log("🏁 Real BGE-M3 test completed!");
  }
}

export function createTestConfig(campaigns: CampaignTestData[], options: Partial<TestConfig> = {}): TestConfig {
  return {
    campaigns,
    confidence_threshold: 0.7,
    ...options
  };
}

// Multilingual CAN Mercosur campaign data (16 languages)
const canMercosurMultilingualData: CampaignTestData = {
  campaign_name: "can_mercosur_2026",
  messages: [
    {
      subject: "Ensure democratic scrutiny before EU–Mercosur application",
      message: "Please respect the democratic role of the European Parliament and do not proceed with applying the EU-Mercosur agreement before MEPs have voted. Public debate around the EU-Mercosur agreement has highlighted significant concerns about its social and environmental consequences. These concerns deserve full democratic scrutiny.",
      language: "en",
      expected_campaign: "CAN Mercosur 2026"
    },
    {
      subject: "UE-Mercоsur : respecter le processus juridique",
      message: "Je vous demande respectueusement de ne pas appliquer l'accord UE-Mercosur tant que le Parlement européen n'a pas pu exercer son droit de vote démocratique. Le débat public autour de l'accord UE-Mercosur a mis en lumière des préoccupations importantes concernant ses conséquences sociales et environnementales.",
      language: "fr",
      expected_campaign: "CAN Mercosur 2026"
    },
    {
      subject: "Keinе vorläufige Anwendung des EU-Mercosur-Abkommens",
      message: "Ich fordere Sie auf, die demokratischen Prozesse zu respektieren und das Handelsabkommen zwischen der EU und dem Mercosur nicht anzuwenden, bevor das Europäische Parlament von seinem Recht, über das Abkommen abzustimmen, Gebrauch gemacht hat. Viele Bürger und zivilgesellschaftliche Gruppen haben ernsthafte Bedenken über die Auswirkungen des Abkommens geäußert.",
      language: "de",
      expected_campaign: "CAN Mercosur 2026"
    },
    {
      subject: "Aplıcación provisional de EU-Mercosur",
      message: "Por favor, respete el papel democrático del Parlamento Europeo y no proceda a aplicar el acuerdo UE-Mercosur antes de que los eurodiputados hayan votado. Muchas personas de toda Europa y de los países del Mercosur han planteado importantes cuestiones sobre las posibles repercusiones del acuerdo.",
      language: "es",
      expected_campaign: "CAN Mercosur 2026"
    },
    {
      subject: "Do not provisiоnally apply the EU–Mercosur agreement",
      message: "Please commit to respecting democratic oversight by not applying the EU-Mercosur agreement before the European Parliament has formally voted. Public debate around the EU-Mercosur agreement has highlighted significant concerns about its social and environmental consequences.",
      language: "it",
      expected_campaign: "CAN Mercosur 2026"
    },
    {
      subject: "Wachten op democrаtische goedkeuring alvorens EU-Mercosur toe te passen",
      message: "Ik drıng er bij u op aan ervoor te zorgen dat de democratische procedures volledig worden gerespecteerd door de stemming van het Europees Parlement af te wachten alvorens de overeenkomst tussen de EU en Mercosur toe te passen. Het publiek maakt zich grote zorgen over de overeenkomst.",
      language: "nl",
      expected_campaign: "CAN Mercosur 2026"
    },
    {
      subject: "Aplicação provısória do EU-Mercosur",
      message: "Exorto-o a respeitar o mandato democrático do Parlamento Europeu e a abster-se de aplicar o acordo UE-Mercosul antes da sua aprovação. O acordo suscitou fortes preocupações por parte de cidadãos e organizações de ambos os lados do Atlântico.",
      language: "pt",
      expected_campaign: "CAN Mercosur 2026"
    },
    {
      subject: "Nie stosuj tymczasowo umowy UE-Mercosur",
      message: "Proszę o poszanowanie roli demokratycznej Parlamentu Europejskiego i niewprowadzanie w życie umowy UE-Mercosur przed głosowaniem europosłów. Publiczna debata na temat umowy UE-Mercosur ujawniła znaczące obawy dotyczące jej społecznych i środowiskowych konsekwencji.",
      language: "pl",
      expected_campaign: "CAN Mercosur 2026"
    },
    {
      subject: "Tillämpa inte EU-Mercosur-avtalet provisoriskt",
      message: "Jag uppmanar er att respektera det europeiska parlamentets demokratiska roll och inte gå vidare med att tillämpa EU-Mercosur-avtalet innan parlamentet har röstat. Den offentliga debatten kring avtalet har lyft fram betydande farhågor om dess sociala och miljömässiga konsekvenser.",
      language: "sv",
      expected_campaign: "CAN Mercosur 2026"
    },
    {
      subject: "Не прилагайте временно ЕС-Меркосур споразумение",
      message: "Моля ви да уважите демократичната роля на Европейския парламент и да не прилагате споразумението ЕС-Меркосур, преди депутатите да гласуват. Общественият дебат около споразумението ЕС-Меркосур подчерта значителни притеснения относно социалните и екологичните му последици.",
      language: "bg",
      expected_campaign: "CAN Mercosur 2026"
    },
    {
      subject: "Neaplikujte dočasne dohodu EU-Mercosur",
      message: "Prosim vas, da spoštajte demokratično vlogo Evropskega parlamenta in ne uvedite v veljavo sporazuma EU-Mercosur, preden parlament glasuje. Javna razprava o sporazumu EU-Mercosur je pokazala pomembne skrbi glede socialnih in okoljskih posledic.",
      language: "sl",
      expected_campaign: "CAN Mercosur 2026"
    },
    {
      subject: "EU-Mercosur megállapodást ne alkalmazzák ideiglenesen",
      message: "Kérem, tiszteljék meg az Európai Parlament demokratikus szerepét és ne lépjenek életbe az EU-Mercosur megállapodással, mielőtt a parlament képviselői szavaznának. Az EU-Mercosur megállapodással kapcsolatos nyilvános vita jelentős aggodalmakat vetett fel társadalmi és környezeti következményei miatt.",
      language: "hu",
      expected_campaign: "CAN Mercosur 2026"
    },
    {
      subject: "Prоvisional application of EU-Mercosur",
      message: "I respectfully ask you to refrain from applying the EU-Mercosur agreement until the European Parliament has been able to exercise its democratic right to vote. Given the scale of public concern surrounding the EU-Mercosur agreement, it is crucial that democratic institutions are allowed to properly examine and decide on the matter.",
      language: "da",
      expected_campaign: "CAN Mercosur 2026"
    },
    {
      subject: "Do not provisionally aрply the EU–Mercosur agreement",
      message: "I respectfully ask you to refrain from applying the EU-Mercosur agreement until the European Parliament has been able to exercise its democratic right to vote. Public debate around the EU-Mercosur agreement has highlighted significant concerns about its social and environmental consequences.",
      language: "fi",
      expected_campaign: "CAN Mercosur 2026"
    },
    {
      subject: "No provisional application оf EU–Mercosur without Parliament consent",
      message: "I respectfully ask you to refrain from applying the EU-Mercosur agreement until the European Parliament has been able to exercise its democratic right to vote. There are widespread public concerns about the EU-Mercosur agreement, including its potential effects on environmental protection, agricultural livelihoods, and food standards.",
      language: "el",
      expected_campaign: "CAN Mercosur 2026"
    },
    {
      subject: "EU-Mercosur provisional applicаtion",
      message: "I respectfully ask you to refrain from applying the EU-Mercosur agreement until the European Parliament has been able to exercise its democratic right to vote. Many people across Europe and Mercosur countries have raised important questions about the agreement's potential impacts.",
      language: "ro",
      expected_campaign: "CAN Mercosur 2026"
    }
  ]
};

async function runRealMultilingualTest() {
  console.log("🌍 Real Multilingual CAN Mercosur 2026 Classification Test");
  console.log("=======================================================");
  console.log("🔥 Using ACTUAL BGE-M3 model (not mocked)");
  console.log(`📝 Testing ${canMercosurMultilingualData.messages.length} languages`);
  console.log("⏳ This may take a few minutes for first run (model download)...\n");

  // Show languages being tested
  console.log("🌐 Languages:");
  canMercosurMultilingualData.messages.forEach((msg, index) => {
    const languageName = getLanguageName(msg.language || "unknown");
    console.log(`   ${index + 1}. ${languageName} (${msg.language?.toUpperCase()})`);
  });
  console.log("");

  // Create test configuration
  const config = createTestConfig([canMercosurMultilingualData], {
    confidence_threshold: 0.7
  });

  // Initialize tester
  const tester = new RealCampaignClassificationTester(config);

  // Run tests with real embeddings
  const results = await tester.testAllCampaigns();

  // Print summary
  results.printSummary();

  // Analysis of real confidence scores
  const campaignResult = results.campaign_results[0];
  if (campaignResult) {
    console.log("\n🔍 Real Confidence Analysis:");
    console.log("==========================");

    const confidences = campaignResult.message_results.map(r => r.confidence);
    const minConf = Math.min(...confidences);
    const maxConf = Math.max(...confidences);
    const range = maxConf - minConf;

    console.log(`📊 Confidence Range: ${minConf.toFixed(3)} - ${maxConf.toFixed(3)} (range: ${range.toFixed(3)})`);
    console.log(`📈 Standard Deviation: ${calculateStandardDeviation(confidences).toFixed(3)}`);

    // Find languages with highest/lowest confidence
    const highest = campaignResult.message_results.reduce((max, msg) => msg.confidence > max.confidence ? msg : max);
    const lowest = campaignResult.message_results.reduce((min, msg) => msg.confidence < min.confidence ? msg : min);

    console.log(`🏆 Highest confidence: ${highest.language} (${highest.confidence.toFixed(3)})`);
    console.log(`📉 Lowest confidence: ${lowest.language} (${lowest.confidence.toFixed(3)})`);

    // Language family analysis
    console.log("\n👨‍👩‍👧‍👦 Language Family Analysis:");
    const languageGroups = groupLanguagesByFamily(campaignResult.message_results);
    Object.entries(languageGroups).forEach(([family, messages]) => {
      const successRate = (messages.filter(m => m.success).length / messages.length) * 100;
      const avgConf = messages.reduce((sum, m) => sum + m.confidence, 0) / messages.length;
      console.log(`   ${family}: ${successRate.toFixed(1)}% success, ${avgConf.toFixed(3)} avg confidence`);
      console.log(`     Individual confidences: ${messages.map(m => `${m.language}(${m.confidence.toFixed(3)})`).join(', ')}`);
    });
  }
}

function calculateStandardDeviation(values: number[]): number {
  const mean = values.reduce((sum, val) => sum + val, 0) / values.length;
  const squaredDiffs = values.map(val => Math.pow(val - mean, 2));
  const avgSquaredDiff = squaredDiffs.reduce((sum, val) => sum + val, 0) / values.length;
  return Math.sqrt(avgSquaredDiff);
}

function getLanguageName(code: string): string {
  const languages: Record<string, string> = {
    'en': 'English',
    'fr': 'French',
    'de': 'German',
    'es': 'Spanish',
    'it': 'Italian',
    'nl': 'Dutch',
    'pt': 'Portuguese',
    'pl': 'Polish',
    'sv': 'Swedish',
    'bg': 'Bulgarian',
    'sl': 'Slovenian',
    'hu': 'Hungarian',
    'da': 'Danish',
    'fi': 'Finnish',
    'el': 'Greek',
    'ro': 'Romanian'
  };
  return languages[code] || code;
}

function groupLanguagesByFamily(messages: any[]): Record<string, any[]> {
  const families: Record<string, any[]> = {
    'Germanic': [],
    'Romance': [],
    'Slavic': [],
    'Other': []
  };

  messages.forEach(msg => {
    const lang = msg.language || 'unknown';
    if (['en', 'de', 'nl', 'sv', 'da'].includes(lang)) {
      families['Germanic'].push(msg);
    } else if (['fr', 'es', 'it', 'pt', 'ro'].includes(lang)) {
      families['Romance'].push(msg);
    } else if (['pl', 'bg', 'sl'].includes(lang)) {
      families['Slavic'].push(msg);
    } else {
      families['Other'].push(msg);
    }
  });

  return families;
}

// Run the test
if (import.meta.url === `file://${process.argv[1]}`) {
  runRealMultilingualTest().catch(console.error);
}

export { runRealMultilingualTest };
