/**
 * Pre-load BGE-M3 model to cache it locally
 * Run this once before starting the dev server
 */

import { pipeline } from "@xenova/transformers";

async function preloadModel(retries = 3) {
  console.log("🔄 Downloading and caching BGE-M3 model...");
  console.log("This may take 2-5 minutes on first run.");
  console.log("Note: Download will resume if interrupted.\n");

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const start = Date.now();

      console.log(`Attempt ${attempt}/${retries}...`);

      const model = await pipeline("feature-extraction", "Xenova/bge-m3", {
        quantized: true,
        progress_callback: (progress: any) => {
          if (progress.status === 'progress') {
            const percent = ((progress.loaded / progress.total) * 100).toFixed(1);
            process.stdout.write(`\r📥 Downloading: ${percent}% (${(progress.loaded / 1024 / 1024).toFixed(1)}MB / ${(progress.total / 1024 / 1024).toFixed(1)}MB)`);
          } else if (progress.status === 'done') {
            console.log('\n✅ Download complete');
          }
        }
      });

      console.log(`\n✅ Model loaded in ${((Date.now() - start) / 1000).toFixed(1)}s`);

      // Test it
      console.log("\n🧪 Testing model...");
      const testOutput = await model("Hello world", {
        pooling: "mean",
        normalize: true,
      });

      const embedding = Array.from(testOutput.data as Float32Array);
      console.log(`✅ Generated ${embedding.length}-dimensional embedding`);
      console.log("\n✨ Model is ready! You can now run the dev server and tests.");

      return; // Success!

    } catch (error) {
      console.error(`\n❌ Attempt ${attempt} failed:`, error instanceof Error ? error.message : error);

      if (attempt < retries) {
        console.log(`\n⏳ Retrying in 5 seconds...\n`);
        await new Promise(resolve => setTimeout(resolve, 5000));
      } else {
        console.error("\n❌ All attempts failed. Please check your internet connection and try again.");
        console.error("You can run: npm run model:preload");
        process.exit(1);
      }
    }
  }
}

preloadModel().catch(console.error);
