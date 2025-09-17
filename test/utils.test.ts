
import { describe, it, expect } from 'vitest'
import { hashEmail } from '../src/database'

describe('Utility Functions', () => {
  describe('hashEmail', () => {
    it('should hash email consistently', async () => {
      const email = 'test@example.com'
      const hash1 = await hashEmail(email)
      const hash2 = await hashEmail(email)

      expect(hash1).toBe(hash2)
      expect(hash1).toHaveLength(64) // SHA-256 hex string
    })

    it('should normalize email case', async () => {
      const hash1 = await hashEmail('Test@Example.Com')
      const hash2 = await hashEmail('test@example.com')

      expect(hash1).toBe(hash2)
    })

    it('should trim whitespace', async () => {
      const hash1 = await hashEmail('  test@example.com  ')
      const hash2 = await hashEmail('test@example.com')

      expect(hash1).toBe(hash2)
    })
  })
})
