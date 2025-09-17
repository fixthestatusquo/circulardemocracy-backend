// vitest.config.ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/',
        'test/',
        'dist/',
        '**/*.d.ts',
        '**/*.config.*',
      ],
      thresholds: {
        global: {
          branches: 80,
          functions: 80,
          lines: 80,
          statements: 80,
        },
      },
    },
    setupFiles: ['./test/setup.ts'],
  },
  esbuild: {
    target: 'es2022',
  },
})

// test/setup.ts
import { vi } from 'vitest'

// Mock Cloudflare Workers globals
global.crypto = {
  subtle: {
    digest: vi.fn().mockImplementation(async (algorithm: string, data: BufferSource) => {
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
    })
  }
} as Crypto

// Mock console methods for cleaner test output
const originalConsole = console
global.console = {
  ...originalConsole,
  log: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
}

// Restore console for debugging when needed
export function restoreConsole() {
  global.console = originalConsole
}
