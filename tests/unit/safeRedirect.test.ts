import { describe, expect, it } from 'vitest'
import { safeRedirect } from '@/lib/auth/safeRedirect'

/**
 * Redirection après connexion.
 *
 * La destination vient du client : un lien de connexion authentiquement nôtre
 * ne doit jamais déposer le visiteur sur un site tiers.
 */

describe('safeRedirect', () => {
  it('should accept an internal path when it starts with a single slash', () => {
    expect(safeRedirect('/mon-compte')).toBe('/mon-compte')
  })

  it('should preserve the query string when the path carries one', () => {
    // Une invitation ne vit que par son jeton : le perdre rendrait le lien
    // reçu par courriel irrécupérable.
    expect(safeRedirect('/invitation?jeton=abc')).toBe('/invitation?jeton=abc')
  })

  it('should reject an absolute url when a scheme is given', () => {
    expect(safeRedirect('https://evil.example/phishing')).toBeNull()
  })

  it('should reject a protocol-relative path when it starts with two slashes', () => {
    expect(safeRedirect('//evil.example')).toBeNull()
  })

  it('should reject a backslash-prefixed path when browsers would treat it as absolute', () => {
    expect(safeRedirect('/\\evil.example')).toBeNull()
  })

  it('should reject an empty string when no destination was submitted', () => {
    expect(safeRedirect('')).toBeNull()
  })

  it('should reject a non-string value when the field is absent', () => {
    expect(safeRedirect(null)).toBeNull()
    expect(safeRedirect(undefined)).toBeNull()
  })

  it('should reject a relative path when it lacks a leading slash', () => {
    expect(safeRedirect('mon-compte')).toBeNull()
  })
})
