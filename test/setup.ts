
// Mock Cloudflare Workers globals
Object.defineProperty(global, 'crypto', {
  value: {
    subtle: {
      digest: async (algorithm: string, data: BufferSource) => {
        // Simple mock for SHA-256 - in real tests you might want more accurate hashing
        const text = new TextDecoder().decode(data)
        const hash = text.split('').reduce((a, b) => {
          a = ((a << 5) - a) + b.charCodeAt(0)
          return a & a
        }, 0)
        
        // Convert to ArrayBuffer (simplified mock)
        const buffer = new ArrayBuffer(32) // SHA-256 is 32 bytes
        const view = new Uint8Array(buffer)
        for (let i = 0; i < 32; i++) {
          view[i] = Math.abs(hash + i) % 256
        }
        return buffer
      }
    }
  },
  configurable: true
});

// Mock console methods for cleaner test output
const originalConsole = console
global.console = {
  ...originalConsole,
  log: () => {},
  error: () => {},
  warn: () => {},
  info: () => {},
}

// Restore console for debugging when needed
export function restoreConsole() {
  global.console = originalConsole
}

// Mock fetch globally
global.fetch = (() => {}) as any;
