import { beforeEach, describe, expect, it } from 'vitest'
import {
  availabilityCacheKey,
  cacheSize,
  clearCache,
  invalidateSalon,
  readCache,
  writeCache,
} from '@/features/availability/cache'

const from = new Date('2026-07-15T00:00:00Z')
const to = new Date('2026-07-16T00:00:00Z')

const key = (overrides: Partial<Parameters<typeof availabilityCacheKey>[0]> = {}) =>
  availabilityCacheKey({
    salonId: 'salon-a',
    serviceIds: ['coupe'],
    memberId: null,
    from,
    to,
    ...overrides,
  })

describe('cache des disponibilités', () => {
  beforeEach(() => {
    clearCache()
  })

  describe('clé', () => {
    it('should produce the same key for the same query', () => {
      expect(key()).toBe(key())
    })

    it('should ignore the order of the requested services', () => {
      // Un même panier saisi dans un autre ordre doit toucher la même entrée.
      const a = key({ serviceIds: ['coupe', 'couleur'] })
      const b = key({ serviceIds: ['couleur', 'coupe'] })

      expect(a).toBe(b)
    })

    it('should differ across salons', () => {
      expect(key()).not.toBe(key({ salonId: 'salon-b' }))
    })

    it('should differ between a specific hairdresser and « any »', () => {
      expect(key()).not.toBe(key({ memberId: 'camille' }))
    })

    it('should differ across windows', () => {
      expect(key()).not.toBe(key({ to: new Date('2026-07-17T00:00:00Z') }))
    })

    it('should start with the salon id, so invalidation can match on it', () => {
      expect(key()).toMatch(/^salon-a\|/)
    })
  })

  describe('lecture et écriture', () => {
    it('should return undefined for an unknown key', () => {
      expect(readCache('inconnue')).toBeUndefined()
    })

    it('should return the stored value', () => {
      writeCache('k', { slots: [1, 2] })

      expect(readCache('k')).toEqual({ slots: [1, 2] })
    })

    it('should expire an entry once its ttl has passed', () => {
      writeCache('k', 'valeur', 1000)
      const later = Date.now() + 1001

      expect(readCache('k', later)).toBeUndefined()
    })

    it('should still return the entry just before expiry', () => {
      writeCache('k', 'valeur', 1000)
      const justBefore = Date.now() + 500

      expect(readCache('k', justBefore)).toBe('valeur')
    })

    it('should drop an expired entry from the store', () => {
      writeCache('k', 'valeur', 1000)
      readCache('k', Date.now() + 2000)

      expect(cacheSize()).toBe(0)
    })

    it('should bound the number of entries', () => {
      for (let i = 0; i < 600; i++) {
        writeCache(`k${i}`, i)
      }

      expect(cacheSize()).toBeLessThanOrEqual(500)
    })
  })

  describe('invalidation', () => {
    it('should drop every entry of the salon', () => {
      writeCache(key(), 'a')
      writeCache(key({ memberId: 'camille' }), 'b')

      invalidateSalon('salon-a')

      expect(readCache(key())).toBeUndefined()
      expect(readCache(key({ memberId: 'camille' }))).toBeUndefined()
    })

    it('should leave other salons untouched', () => {
      // Une réservation dans un salon ne doit pas vider le cache des autres.
      writeCache(key(), 'a')
      writeCache(key({ salonId: 'salon-b' }), 'b')

      invalidateSalon('salon-a')

      expect(readCache(key({ salonId: 'salon-b' }))).toBe('b')
    })

    it('should not match a salon whose id is a prefix of another', () => {
      writeCache(key({ salonId: 'salon' }), 'court')
      writeCache(key({ salonId: 'salon-a' }), 'long')

      invalidateSalon('salon')

      expect(readCache(key({ salonId: 'salon' }))).toBeUndefined()
      expect(readCache(key({ salonId: 'salon-a' }))).toBe('long')
    })
  })
})
