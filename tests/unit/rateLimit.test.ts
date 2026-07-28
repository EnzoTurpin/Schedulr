import { beforeEach, describe, expect, it } from 'vitest'
import { RULES, callerKey, clearRateLimits, consume, reset } from '@/lib/rateLimit'

/**
 * Limitation de débit.
 *
 * L'enjeu : bloquer le bourrage d'identifiants sans pénaliser un utilisateur
 * qui se trompe de mot de passe une fois.
 */

const RULE = { limit: 3, windowMs: 60_000 }
const NOW = 1_000_000

describe('consume', () => {
  beforeEach(() => {
    clearRateLimits()
  })

  it('should allow the first attempt', () => {
    const result = consume('ip', RULE, NOW)

    expect(result.allowed).toBe(true)
    expect(result.remaining).toBe(2)
  })

  it('should count down the remaining attempts', () => {
    consume('ip', RULE, NOW)
    const second = consume('ip', RULE, NOW)

    expect(second.remaining).toBe(1)
  })

  it('should block once the limit is reached', () => {
    for (let i = 0; i < RULE.limit; i++) {
      consume('ip', RULE, NOW)
    }

    const blocked = consume('ip', RULE, NOW)

    expect(blocked.allowed).toBe(false)
    expect(blocked.remaining).toBe(0)
  })

  it('should allow again once the window has passed', () => {
    for (let i = 0; i < RULE.limit; i++) {
      consume('ip', RULE, NOW)
    }

    const later = consume('ip', RULE, NOW + RULE.windowMs + 1)

    expect(later.allowed).toBe(true)
  })

  it('should still block just before the window ends', () => {
    for (let i = 0; i < RULE.limit; i++) {
      consume('ip', RULE, NOW)
    }

    expect(consume('ip', RULE, NOW + RULE.windowMs - 1).allowed).toBe(false)
  })

  it('should keep counters independent per key', () => {
    for (let i = 0; i < RULE.limit; i++) {
      consume('ip-a', RULE, NOW)
    }

    expect(consume('ip-b', RULE, NOW).allowed).toBe(true)
  })

  it('should expose when the window resets', () => {
    expect(consume('ip', RULE, NOW).resetAt).toBe(NOW + RULE.windowMs)
  })
})

describe('reset', () => {
  beforeEach(() => {
    clearRateLimits()
  })

  it('should clear the counter of a key', () => {
    // Appelé après une connexion réussie : une faute de frappe ne doit pas
    // pénaliser durablement.
    for (let i = 0; i < RULE.limit; i++) {
      consume('ip', RULE, NOW)
    }

    reset('ip')

    expect(consume('ip', RULE, NOW).allowed).toBe(true)
  })
})

describe('callerKey', () => {
  it('should use the first address of x-forwarded-for', () => {
    // Le proxy ajoute les intermédiaires à la suite : la première valeur est
    // l'origine réelle.
    const headers = new Headers({ 'x-forwarded-for': '203.0.113.7, 10.0.0.1' })

    expect(callerKey(headers, 'login')).toBe('login:203.0.113.7')
  })

  it('should fall back on x-real-ip', () => {
    const headers = new Headers({ 'x-real-ip': '203.0.113.7' })

    expect(callerKey(headers, 'login')).toBe('login:203.0.113.7')
  })

  it('should fall back on a local key without proxy headers', () => {
    expect(callerKey(new Headers(), 'login')).toBe('login:local')
  })

  it('should separate scopes', () => {
    const headers = new Headers({ 'x-real-ip': '203.0.113.7' })

    expect(callerKey(headers, 'login')).not.toBe(callerKey(headers, 'booking'))
  })
})

describe('règles', () => {
  it('should keep login attempts low enough to block credential stuffing', () => {
    expect(RULES.login.limit).toBeLessThanOrEqual(5)
  })

  it('should keep login attempts high enough for a typo', () => {
    expect(RULES.login.limit).toBeGreaterThanOrEqual(3)
  })

  it('should limit account creation more strictly than login', () => {
    expect(RULES.register.limit).toBeLessThan(RULES.login.limit)
  })
})
