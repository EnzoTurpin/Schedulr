import { describe, expect, it } from 'vitest'
import { can, assertCan } from '@/lib/authz/can'
import {
  ForbiddenError,
  ResourceNotFoundError,
  type Action,
  type Actor,
  type Resource,
} from '@/lib/authz/types'

/**
 * Tests de la matrice d'autorisations (plan d'action, §2).
 *
 * Ils valent contrôle de sécurité : une régression ouvre un accès à des données
 * d'un autre salon ou à des actions de gestion.
 */

const SALON_A = 'salon-a'
const SALON_B = 'salon-b'

function client(userId = 'user-client'): Actor {
  return { userId, role: 'CLIENT', memberships: [] }
}

function staff(userId = 'user-staff', memberId = 'member-staff'): Actor {
  return {
    userId,
    role: 'CLIENT',
    memberships: [{ salonId: SALON_A, memberId, role: 'STAFF', isActive: true }],
  }
}

function manager(): Actor {
  return {
    userId: 'user-manager',
    role: 'CLIENT',
    memberships: [
      { salonId: SALON_A, memberId: 'member-manager', role: 'MANAGER', isActive: true },
    ],
  }
}

function owner(): Actor {
  return {
    userId: 'user-owner',
    role: 'CLIENT',
    memberships: [
      { salonId: SALON_A, memberId: 'member-owner', role: 'OWNER', isActive: true },
    ],
  }
}

function platformAdmin(): Actor {
  return { userId: 'user-admin', role: 'PLATFORM_ADMIN', memberships: [] }
}

const salonA: Resource = { kind: 'salon', salonId: SALON_A }
const salonB: Resource = { kind: 'salon', salonId: SALON_B }

function appointment(
  overrides: Partial<Extract<Resource, { kind: 'appointment' }>> = {},
) {
  return {
    kind: 'appointment' as const,
    salonId: SALON_A,
    memberId: 'member-staff',
    clientId: null,
    ...overrides,
  }
}

describe('matrice d’autorisations', () => {
  describe('client', () => {
    it('should allow a client to book an appointment', () => {
      expect(can(client(), 'appointment:book', salonA)).toBe(true)
    })

    it('should allow a client to cancel their own appointment', () => {
      const actor = client('user-1')
      const resource = appointment({ clientId: 'user-1' })

      expect(can(actor, 'appointment:cancel_own', resource)).toBe(true)
    })

    it('should deny a client cancelling someone else’s appointment', () => {
      const actor = client('user-1')
      const resource = appointment({ clientId: 'user-2' })

      expect(can(actor, 'appointment:cancel_own', resource)).toBe(false)
    })

    it('should deny a client reading the salon agenda', () => {
      expect(can(client(), 'agenda:read_salon', salonA)).toBe(false)
    })

    it('should deny a client managing services', () => {
      expect(can(client(), 'service:manage', salonA)).toBe(false)
    })
  })

  describe('coiffeur (STAFF)', () => {
    it('should allow reading the salon agenda', () => {
      expect(can(staff(), 'agenda:read_salon', salonA)).toBe(true)
    })

    it('should allow managing their own time off', () => {
      expect(can(staff(), 'timeoff:manage_own', salonA)).toBe(true)
    })

    it('should deny managing someone else’s time off', () => {
      expect(can(staff(), 'timeoff:manage_any', salonA)).toBe(false)
    })

    it('should deny creating an appointment for another hairdresser', () => {
      expect(can(staff(), 'appointment:write_any', salonA)).toBe(false)
    })

    it('should allow setting the status of their own appointment', () => {
      const actor = staff('user-s', 'member-s')
      const resource = appointment({ memberId: 'member-s' })

      expect(can(actor, 'appointment:set_status', resource)).toBe(true)
    })

    it('should deny setting the status of a colleague’s appointment', () => {
      const actor = staff('user-s', 'member-s')
      const resource = appointment({ memberId: 'member-autre' })

      expect(can(actor, 'appointment:set_status', resource)).toBe(false)
    })

    it('should deny managing services', () => {
      expect(can(staff(), 'service:manage', salonA)).toBe(false)
    })

    it('should deny managing team members', () => {
      expect(can(staff(), 'member:manage', salonA)).toBe(false)
    })
  })

  describe('manager', () => {
    it('should allow managing services', () => {
      expect(can(manager(), 'service:manage', salonA)).toBe(true)
    })

    it('should allow creating an appointment for any hairdresser', () => {
      expect(can(manager(), 'appointment:write_any', salonA)).toBe(true)
    })

    it('should allow managing the salon schedule', () => {
      expect(can(manager(), 'schedule:manage_salon', salonA)).toBe(true)
    })

    it('should allow reading salon statistics', () => {
      expect(can(manager(), 'stats:read', salonA)).toBe(true)
    })

    it('should inherit staff permissions', () => {
      expect(can(manager(), 'agenda:read_own', salonA)).toBe(true)
    })

    it('should deny managing team members, which is reserved to the owner', () => {
      expect(can(manager(), 'member:manage', salonA)).toBe(false)
    })

    it('should deny reading the salon audit log', () => {
      expect(can(manager(), 'audit:read_salon', salonA)).toBe(false)
    })
  })

  describe('gérant (OWNER)', () => {
    it('should allow managing team members', () => {
      expect(can(owner(), 'member:manage', salonA)).toBe(true)
    })

    it('should allow reading the salon audit log', () => {
      expect(can(owner(), 'audit:read_salon', salonA)).toBe(true)
    })

    it('should inherit manager permissions', () => {
      expect(can(owner(), 'service:manage', salonA)).toBe(true)
    })

    it('should deny creating a salon, which is a platform action', () => {
      expect(can(owner(), 'salon:create', salonA)).toBe(false)
    })

    it('should deny reading the platform audit log', () => {
      expect(can(owner(), 'audit:read_platform', { kind: 'platform' })).toBe(false)
    })
  })

  describe('administrateur plateforme', () => {
    it('should allow creating a salon', () => {
      expect(can(platformAdmin(), 'salon:create', { kind: 'platform' })).toBe(true)
    })

    it('should allow suspending a salon', () => {
      expect(can(platformAdmin(), 'salon:suspend', salonA)).toBe(true)
    })

    it('should allow reading any salon agenda without membership', () => {
      expect(can(platformAdmin(), 'agenda:read_salon', salonB)).toBe(true)
    })

    it('should allow reading the platform audit log', () => {
      expect(can(platformAdmin(), 'audit:read_platform', { kind: 'platform' })).toBe(true)
    })
  })

  describe('isolation entre salons', () => {
    it('should deny reading a foreign salon agenda', () => {
      expect(can(manager(), 'agenda:read_salon', salonB)).toBe(false)
    })

    it('should report a foreign salon as not found rather than forbidden', () => {
      // Un 403 confirmerait l'existence de la ressource à un concurrent
      // (ADR-0002).
      expect(() => assertCan(manager(), 'agenda:read_salon', salonB)).toThrow(
        ResourceNotFoundError,
      )
    })

    it('should report a foreign appointment as not found', () => {
      const resource = appointment({ salonId: SALON_B })

      expect(() => assertCan(manager(), 'appointment:write_any', resource)).toThrow(
        ResourceNotFoundError,
      )
    })

    it('should treat a deactivated membership as no access at all', () => {
      const revoked: Actor = {
        userId: 'user-ex',
        role: 'CLIENT',
        memberships: [
          { salonId: SALON_A, memberId: 'member-ex', role: 'MANAGER', isActive: false },
        ],
      }

      expect(can(revoked, 'agenda:read_salon', salonA)).toBe(false)
      expect(() => assertCan(revoked, 'agenda:read_salon', salonA)).toThrow(
        ResourceNotFoundError,
      )
    })

    it('should still let a client cancel their own appointment in a salon they do not work for', () => {
      const actor = client('user-1')
      const resource = appointment({ salonId: SALON_B, clientId: 'user-1' })

      expect(can(actor, 'appointment:cancel_own', resource)).toBe(true)
    })
  })

  describe('assertCan', () => {
    it('should not throw when the action is allowed', () => {
      expect(() => assertCan(owner(), 'member:manage', salonA)).not.toThrow()
    })

    it('should throw ForbiddenError when the role is insufficient', () => {
      expect(() => assertCan(staff(), 'member:manage', salonA)).toThrow(ForbiddenError)
    })

    it('should throw ResourceNotFoundError for a foreign salon', () => {
      expect(() => assertCan(manager(), 'service:manage', salonB)).toThrow(
        ResourceNotFoundError,
      )
    })
  })

  describe('exhaustivité', () => {
    it('should deny every action to a plain client on a salon they do not belong to', () => {
      // Balayage complet : aucune action de gestion ne doit être ouverte par
      // défaut à un compte sans appartenance.
      const managementActions: Action[] = [
        'agenda:read_own',
        'agenda:read_salon',
        'appointment:write_any',
        'appointment:set_status',
        'service:manage',
        'schedule:manage_salon',
        'timeoff:manage_own',
        'timeoff:manage_any',
        'salon:update',
        'stats:read',
        'member:manage',
        'salon:create',
        'salon:suspend',
        'audit:read_salon',
        'audit:read_platform',
      ]

      for (const action of managementActions) {
        expect(
          can(client(), action, salonA),
          `action ${action} devrait être refusée`,
        ).toBe(false)
      }
    })
  })
})
