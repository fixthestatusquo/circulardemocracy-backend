// Mock Cloudflare Workers globals
Object.defineProperty(global, "crypto", {
  value: {
    subtle: {
      importKey: async (
        _format: string,
        _keyData: BufferSource,
        _algorithm: any,
        _extractable: boolean,
        _keyUsages: string[],
      ) => {
        return {
          type: "secret",
          algorithm: { name: "HMAC" },
          extractable: true,
          usages: ["sign", "verify"],
        } as unknown as CryptoKey;
      },
      digest: async (_algorithm: string, data: BufferSource) => {
        // Simple mock for SHA-256 - in real tests you might want more accurate hashing
        const text = new TextDecoder().decode(data);
        const hash = text.split("").reduce((a, b) => {
          a = (a << 5) - a + b.charCodeAt(0);
          return a & a;
        }, 0);

        // Convert to ArrayBuffer (simplified mock)
        const buffer = new ArrayBuffer(32); // SHA-256 is 32 bytes
        const view = new Uint8Array(buffer);
        for (let i = 0; i < 32; i++) {
          view[i] = Math.abs(hash + i) % 256;
        }
        return buffer;
      },
    },
  },
  configurable: true,
});

// Ensure test-safe defaults when bindings are unavailable
process.env.SUPABASE_URL ||= "https://test.supabase.co";
process.env.SUPABASE_KEY ||= "test-key";
process.env.API_KEY ||= "test-api-key";

// Compatibility helper used by older tests.
export function restoreConsole() {
  // No-op: console is no longer globally mocked in setup.
}


