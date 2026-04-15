/**
 * Embedding Service - Provides BGE-M3 embeddings for both local and Cloudflare Workers environments
 */

import { type FeatureExtractionPipeline, pipeline } from "@xenova/transformers";

export interface Ai {
  run(model: string, inputs: any): Promise<any>;
}

let embeddingPipeline: FeatureExtractionPipeline | null = null;

/**
 * Initialize the local BGE-M3 model using Transformers.js
 * This is only used in local development (Node.js environment)
 */
async function initializeLocalModel(): Promise<FeatureExtractionPipeline> {
  if (embeddingPipeline) {
    return embeddingPipeline;
  }

  console.log(
    "🔄 Loading BGE-M3 model (first time may take a few minutes to download)...",
  );

  embeddingPipeline = await pipeline("feature-extraction", "Xenova/bge-m3", {
    quantized: true, // Use quantized model for faster inference
  });

  console.log("✅ BGE-M3 model loaded successfully!");

  return embeddingPipeline;
}

/**
 * Format email content for embedding generation
 * Combines subject and body with subject as a markdown header
 * @param subject - Email subject line
 * @param body - Email body content
 * @returns Formatted text with subject as header
 */
export function formatEmailContentForEmbedding(
  subject: string,
  body: string,
): string {
  const cleanSubject = subject.trim();
  const cleanBody = body.trim();

  if (!cleanSubject && !cleanBody) {
    return "";
  }

  if (!cleanSubject) {
    return cleanBody;
  }

  if (!cleanBody) {
    return `# ${cleanSubject}`;
  }

  return `# ${cleanSubject}\n\n${cleanBody}`;
}

/**
 * Generate embeddings using BGE-M3 model
 * Automatically detects environment and uses appropriate method:
 * - Cloudflare Workers: Uses Workers AI binding
 * - Local Node.js: Uses Transformers.js with ONNX model
 */
export async function generateEmbedding(
  ai: Ai | null,
  text: string,
): Promise<number[]> {
  try {
    const truncatedText = text.substring(0, 8000); // Limit to avoid token limits

    // If AI binding is available (Cloudflare Workers), use it
    if (ai?.run) {
      const response = await ai.run("@cf/baai/bge-m3", {
        text: truncatedText,
      });
      return response.data[0] as number[];
    }

    // Otherwise, use local Transformers.js model
    const model = await initializeLocalModel();

    const output = await model(truncatedText, {
      pooling: "mean",
      normalize: true,
    });

    // Convert tensor to array
    const embedding = Array.from(output.data as Float32Array);

    // BGE-M3 produces 1024-dimensional embeddings
    if (embedding.length !== 1024) {
      console.warn(
        `Warning: Expected 1024 dimensions, got ${embedding.length}`,
      );
    }

    return embedding;
  } catch (error) {
    console.error("Embedding generation error:", error);
    throw new Error("Failed to generate message embedding");
  }
}

/**
 * Cleanup function to free model resources
 * Call this when shutting down the server
 */
export async function cleanupEmbeddingService(): Promise<void> {
  if (embeddingPipeline) {
    // Transformers.js doesn't have explicit cleanup, but we can null the reference
    embeddingPipeline = null;
    console.log("🧹 Embedding service cleaned up");
  }
}
