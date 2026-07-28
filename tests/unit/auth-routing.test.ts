import { describe, expect, it } from 'vitest'
import { landingPath, professionalSalons } from '@/lib/auth/actor'
import { loginSchema, registerSchema } from '@/lib/auth/schemas'
import type { Actor } from '@/lib/authz/types'

/** Constructeur d'appelant, pour des cas lisibles. */
function actor(overrides: Partial<Actor> = {}): Actor {
  return { userId: 'u1', role: 'CLIENT', memberships: [], ...overrides }
}

const membership = (salonId: string, isActive = true) => ({
  salonId,
  memberId: `m-${salonId}`,
  role: 'STAFF' as const,
  isActive,
})

describe('professionalSalons', () => {
  it('should return nothing for a plain client', () => {
    expect(professionalSalons(actor())).toEqual([])
  })

  it('should return the active memberships', () => {
    const result = professionalSalons(actor({ memberships: [membership('salon-a')] }))

    expect(result).toHaveLength(1)
  })

  it('should exclude deactivated memberships', () => {
    // Un coiffeur qui a quitté le salon ne doit plus y avoir accès.
    const result = professionalSalons(
      actor({ memberships: [membership('salon-a', false)] }),
    )

    expect(result).toEqual([])
  })

  it('should keep only the active ones when both are present', () => {
    const result = professionalSalons(
      actor({ memberships: [membership('salon-a', false), membership('salon-b')] }),
    )

    expect(result.map((m) => m.salonId)).toEqual(['salon-b'])
  })
})

describe('landingPath', () => {
  it('should send a plain client to their personal area', () => {
    expect(landingPath(actor())).toBe('/mon-compte')
  })

  it('should send a salon member to the professional area', () => {
    expect(landingPath(actor({ memberships: [membership('salon-a')] }))).toBe('/pro')
  })

  it('should send a platform admin to the back office', () => {
    expect(landingPath(actor({ role: 'PLATFORM_ADMIN' }))).toBe('/admin')
  })

  it('should prefer the back office when an admin also works in a salon', () => {
    const result = landingPath(
      actor({ role: 'PLATFORM_ADMIN', memberships: [membership('salon-a')] }),
    )

    expect(result).toBe('/admin')
  })

  it('should send a revoked member back to the client area', () => {
    // Son accès professionnel est tombé : il reste client de la plateforme.
    const result = landingPath(actor({ memberships: [membership('salon-a', false)] }))

    expect(result).toBe('/mon-compte')
  })
})

describe('loginSchema', () => {
  it('should accept a valid pair', () => {
    const result = loginSchema.safeParse({ email: 'a@b.fr', password: 'peu-importe' })

    expect(result.success).toBe(true)
  })

  it('should normalise the email to lowercase and trim it', () => {
    const result = loginSchema.parse({ email: '  A@B.FR ', password: 'x' })

    expect(result.email).toBe('a@b.fr')
  })

  it('should reject a malformed email', () => {
    expect(loginSchema.safeParse({ email: 'pas-un-email', password: 'x' }).success).toBe(
      false,
    )
  })

  it('should reject an empty password', () => {
    expect(loginSchema.safeParse({ email: 'a@b.fr', password: '' }).success).toBe(false)
  })

  it('should not enforce a minimum password length at login', () => {
    // Refuser un mot de passe « trop court » à la connexion renseignerait un
    // attaquant sur la politique appliquée.
    expect(loginSchema.safeParse({ email: 'a@b.fr', password: 'court' }).success).toBe(
      true,
    )
  })
})

describe('registerSchema', () => {
  const valid = {
    email: 'a@b.fr',
    password: 'un-mot-de-passe-valide',
    firstName: 'Camille',
    lastName: 'Bernard',
  }

  it('should accept a valid registration', () => {
    expect(registerSchema.safeParse(valid).success).toBe(true)
  })

  it('should reject a password shorter than the minimum length', () => {
    const result = registerSchema.safeParse({ ...valid, password: 'court' })

    expect(result.success).toBe(false)
  })

  it('should reject an excessively long password', () => {
    // Hacher plusieurs mégaoctets à chaque tentative offrirait un levier de
    // déni de service.
    const result = registerSchema.safeParse({ ...valid, password: 'a'.repeat(201) })

    expect(result.success).toBe(false)
  })

  it('should reject an empty first name', () => {
    expect(registerSchema.safeParse({ ...valid, firstName: '   ' }).success).toBe(false)
  })

  it('should trim names', () => {
    const result = registerSchema.parse({ ...valid, firstName: '  Camille  ' })

    expect(result.firstName).toBe('Camille')
  })
})
