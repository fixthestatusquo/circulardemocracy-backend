/**
 * CAN Mercosur 2026 Multilingual Campaign Classification Test
 * Tests real BGE-M3 embeddings across 16 languages for CAN Mercosur campaign
 * Run with: npm run test:can-mercosur
 */

import dotenv from "dotenv";
dotenv.config();

import { DatabaseClient } from "../src/database";
import { generateEmbedding } from "../src/embedding_service";
import { processMessage } from "../src/message_processor";

// Test configuration
const TEST_CONFIG = {
  confidence_threshold: 0.7,
  languages: [
    "en", "fr", "de", "es", "it", "nl", "pt", "pl",
    "sv", "bg", "sl", "hu", "da", "fi", "el", "ro"
  ]
};

// Test messages in different languages
const MULTILINGUAL_MESSAGES = [
  {
    language: "en",
    subject: "Ensure democratic scrutiny before EU–Mercosur application",
    message: "Please respect the democratic role of the European Parliament and do not proceed with applying the EU-Mercosur agreement before MEPs have voted. Public debate around the EU-Mercosur agreement has highlighted significant concerns about its social and environmental consequences.",
    expected_campaign: "CAN Mercosur 2026"
  },
  {
    language: "fr",
    subject: "UE-Mercosur : respecter le processus juridique",
    message: "Je vous demande respectueusement de ne pas appliquer l'accord UE-Mercosur tant que le Parlement européen n'a pas pu exercer son droit de vote démocratique. Le débat public autour de l'accord UE-Mercosur a mis en lumière des préoccupations importantes concernant ses conséquences sociales et environnementales.",
    expected_campaign: "CAN Mercosur 2026"
  },
  {
    language: "de",
    subject: "Keine vorläufige Anwendung des EU-Mercosur-Abkommens",
    message: "Ich fordere Sie auf, die demokratischen Prozesse zu respektieren und das Handelsabkommen zwischen der EU und dem Mercosur nicht anzuwenden, bevor das Europäische Parlament von seinem Recht, über das Abkommen abzustimmen, Gebrauch gemacht hat. Viele Bürger und zivilgesellschaftliche Gruppen haben ernsthafte Bedenken über die Auswirkungen des Abkommens geäußert.",
    expected_campaign: "CAN Mercosur 2026"
  },
  {
    language: "es",
    subject: "Aplicación provisional de EU-Mercosur",
    message: "Por favor, respete el papel democrático del Parlamento Europeo y no proceda a aplicar el acuerdo UE-Mercosur antes de que los eurodiputados hayan votado. Muchas personas de toda Europa y de los países del Mercosur han planteado importantes cuestiones sobre las posibles repercusiones del acuerdo.",
    expected_campaign: "CAN Mercosur 2026"
  },
  {
    language: "it",
    subject: "Do not provisiоnally apply the EU–Mercosur agreement",
    message: "Please commit to respecting democratic oversight by not applying the EU-Mercosur agreement before the European Parliament has formally voted. Public debate around the EU-Mercosur agreement has highlighted significant concerns about its social and environmental consequences.",
    expected_campaign: "CAN Mercosur 2026"
  },
  {
    language: "nl",
    subject: "Wachten op democrаtische goedkeuring alvorens EU-Mercosur toe te passen",
    message: "Ik drıng er bij u op aan ervoor te zorgen dat de democratische procedures volledig worden gerespecteerd door de stemming van het Europees Parlement af te wachten alvorens de overeenkomst tussen de EU en Mercosur toe te passen. Het publiek maakt zich grote zorgen over de overeenkomst.",
    expected_campaign: "CAN Mercosur 2026"
  },
  {
    language: "pt",
    subject: "Aplicação provısória do EU-Mercosur",
    message: "Exorto-o a respeitar o mandato democrático do Parlamento Europeu e a abster-se de aplicar o acordo UE-Mercosul antes da sua aprovação. O acordo suscitou fortes preocupações por parte de cidadãos e organizações de ambos os lados do Atlântico.",
    expected_campaign: "CAN Mercosur 2026"
  },
  {
    language: "pl",
    subject: "Nie stosuj tymczasowo umowy UE-Mercosur",
    message: "Proszę o poszanowanie roli demokratycznej Parlamentu Europejskiego i niewprowadzanie w życie umowy UE-Mercosur przed głosowaniem europosłów. Publiczna debata na temat umowy UE-Mercosur ujawniła znaczące obawy dotyczące jej społecznych i środowiskowych konsekwencji.",
    expected_campaign: "CAN Mercosur 2026"
  },
  {
    language: "sv",
    subject: "Tillämpa inte EU-Mercosur-avtalet provisoriskt",
    message: "Jag uppmanar er att respektera det europeiska parlamentets demokratiska roll och inte gå vidare med att tillämpa EU-Mercosur-avtalet innan parlamentet har röstat. Den offentliga debatten kring avtalet har lyft fram betydande farhågor om dess sociala och miljömässiga konsekvenser.",
    expected_campaign: "CAN Mercosur 2026"
  },
  {
    language: "bg",
    subject: "Не прилагайте временно ЕС-Меркосур споразумение",
    message: "Моля ви да уважите демократичната роля на Европейския парламент и да не прилагате споразумението ЕС-Меркосур, преди депутатите да гласуват. Общественият дебат около споразумението ЕС-Меркосур подчерта значителни притеснения относно социалните и екологичните му последици.",
    expected_campaign: "CAN Mercosur 2026"
  },
  {
    language: "sl",
    subject: "Neaplikujte dočasno dohodo EU-Mercosur",
    message: "Prosim vas, da spoštajte demokratično vlogo Evropskega parlamenta in ne uvedite v veljavo sporazuma EU-Mercosur, preden parlament glasuje. Javna razprava o sporazumu EU-Mercosur je pokazala pomembne skrbi glede socialnih in okoljskih posledic.",
    expected_campaign: "CAN Mercosur 2026"
  },
  {
    language: "hu",
    subject: "EU-Mercosur megállapodást ne alkalmazzák ideiglenesen",
    message: "Kérem, tiszteljék meg az Európai Parlament demokratikus szerepét és ne lépjenek életbe az EU-Mercosur megállapodással, mielőtt a parlament képviselői szavaznának. Az EU-Mercosur megállapodással kapcsolatos nyilvános vita jelentős aggodalmakat vetett fel társadalmi és környezeti következményei miatt.",
    expected_campaign: "CAN Mercosur 2026"
  },
  {
    language: "da",
    subject: "Prоvisional application of EU-Mercosur",
    message: "I respectfully ask you to refrain from applying the EU-Mercosur agreement until the European Parliament has been able to exercise its democratic right to vote. Given the scale of public concern surrounding the EU-Mercosur agreement, it is crucial that democratic institutions are allowed to properly examine and decide on the matter.",
    expected_campaign: "CAN Mercosur 2026"
  },
  {
    language: "fi",
    subject: "Do not provisionally aрply the EU–Mercosur agreement",
    message: "I respectfully ask you to refrain from applying the EU-Mercosur agreement until the European Parliament has been able to exercise its democratic right to vote. Public debate around the EU-Mercosur agreement has highlighted significant concerns about its social and environmental consequences.",
    expected_campaign: "CAN Mercosur 2026"
  },
  {
    language: "el",
    subject: "No provisional application оf EU–Mercosur without Parliament consent",
    message: "I respectfully ask you to refrain from applying the EU-Mercosur agreement until the European Parliament has been able to exercise its democratic right to vote. There are widespread public concerns about the EU-Mercosur agreement, including its potential effects on environmental protection, agricultural livelihoods, and food standards.",
    expected_campaign: "CAN Mercosur 2026"
  },
  {
    language: "ro",
    subject: "EU-Mercosur provisional applicаtion",
    message: "I respectfully ask you to refrain from applying the EU-Mercosur agreement until the European Parliament has been able to exercise its democratic right to vote. Many people across Europe and Mercosur countries have raised important questions about the agreement's potential impacts.",
    expected_campaign: "CAN Mercosur 2026"
  }
];

async function runCanMercosurTest() {
  console.log("🌍 CAN Mercosur 2026 Multilingual Classification Test");
  console.log("====================================================");
  console.log(`📝 Testing ${MULTILINGUAL_MESSAGES.length} languages`);
  console.log("🔥 Using REAL BGE-M3 embeddings (not mocked)");
  console.log("🎯 Confidence threshold:", TEST_CONFIG.confidence_threshold);
  console.log("");

  // Initialize database client
  const db = new DatabaseClient({
    url: process.env.SUPABASE_URL || "",
    key: process.env.SUPABASE_KEY || ""
  });

  // Mock politician to avoid errors
  const mockPolitician = {
    id: 1,
    email: "test@example.com",
    name: "Test MEP",
    country: "EU",
    party: "Test Party",
    additional_emails: [],
    active: true
  };

  // Mock politician lookup
  const originalFindPolitician = db.findPoliticianByEmail.bind(db);
  db.findPoliticianByEmail = async (email: string) => mockPolitician;

  const results = [];
  let successCount = 0;
  let totalConfidence = 0;

  for (let i = 0; i < MULTILINGUAL_MESSAGES.length; i++) {
    const messageData = MULTILINGUAL_MESSAGES[i];
    console.log(`📝 Testing ${messageData.language.toUpperCase()}...`);

    try {
      const messageInput = {
        external_id: `can-mercosur-${messageData.language}-${Date.now()}`,
        sender_name: "Test Citizen",
        sender_email: "test@example.com",
        recipient_email: "test@example.com",
        subject: messageData.subject,
        message: messageData.message,
        timestamp: new Date().toISOString(),
        channel_source: "test"
      };

      const result = await processMessage(db, null as any, messageInput);

      const success = result.campaign_name === messageData.expected_campaign &&
        (result.confidence || 0) >= TEST_CONFIG.confidence_threshold;

      if (success) successCount++;
      totalConfidence += result.confidence || 0;

      results.push({
        language: messageData.language,
        confidence: result.confidence || 0,
        campaign_name: result.campaign_name || "unknown",
        expected_campaign: messageData.expected_campaign,
        success
      });

      console.log(`   ✅ ${messageData.language.toUpperCase()}: ${result.confidence?.toFixed(3)} confidence → ${result.campaign_name}`);
      console.log(`   📊 Success: ${success ? 'YES' : 'NO'}`);

    } catch (error) {
      console.log(`   ❌ ${messageData.language.toUpperCase()}: Error - ${error}`);
      results.push({
        language: messageData.language,
        confidence: 0,
        campaign_name: "error",
        expected_campaign: messageData.expected_campaign,
        success: false
      });
    }
  }

  // Summary
  console.log("\n📊 Test Results Summary");
  console.log("======================");
  console.log(`✅ Successful classifications: ${successCount}/${MULTILINGUAL_MESSAGES.length}`);
  console.log(`📈 Success rate: ${((successCount / MULTILINGUAL_MESSAGES.length) * 100).toFixed(1)}%`);
  console.log(`📊 Average confidence: ${(totalConfidence / MULTILINGUAL_MESSAGES.length).toFixed(3)}`);

  // Language family analysis
  const families = {
    Germanic: ["en", "de", "nl", "sv", "da"],
    Romance: ["fr", "es", "it", "pt", "ro"],
    Slavic: ["pl", "bg", "sl"],
    Other: ["hu", "fi", "el"]
  };

  console.log("\n👨‍👩‍👧‍👦 Language Family Analysis:");
  for (const [family, languages] of Object.entries(families)) {
    const familyResults = results.filter(r => languages.includes(r.language));
    const familySuccess = familyResults.filter(r => r.success).length;
    const familyAvgConfidence = familyResults.reduce((sum, r) => sum + r.confidence, 0) / familyResults.length;

    console.log(`   ${family}: ${familySuccess}/${familyResults.length} (${((familySuccess / familyResults.length) * 100).toFixed(1)}%), avg confidence: ${familyAvgConfidence.toFixed(3)}`);
  }

  // Failed messages
  const failed = results.filter(r => !r.success);
  if (failed.length > 0) {
    console.log("\n❌ Failed classifications:");
    failed.forEach(r => {
      console.log(`   ${r.language.toUpperCase()}: ${r.confidence.toFixed(3)} → ${r.campaign_name} (expected: ${r.expected_campaign})`);
    });
  }

  console.log("\n🏁 Test completed!");
}

// Run the test
runCanMercosurTest().catch(console.error);

export { runCanMercosurTest };
