import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import {
  ActiveMembershipError,
  eraseAccount,
  exportPersonalData,
  purgeExpiredData,
} from '@/features/privacy/dataSubject'
import { createSession, resolveSession } from '@/lib/auth/session'
import type { Actor } from '@/lib/authz/types'
import { resetDatabase, testDb } from './helpers/db'

/**
 * Droits des personnes (RGPD).
 *
 * L'effacement est le point le plus délicat : il doit rendre la personne
 * non identifiable **tout en** préservant ce dont le salon a besoin pour
 * justifier son activité. Ces tests vérifient les deux moitiés.
 */

const NOW = new Date('2026-10-01T12:00:00+02:00')

async function fixture() {
  const salon = await testDb.salon.create({
    data: {
      slug: 'salon-rgpd',
      name: 'Salon RGPD',
      address: '1 rue des Tests',
      city: 'Lyon',
      postalCode: '69000',
      isActive: true,
    },
  })

  const service = await testDb.service.create({
    data: { salonId: salon.id, name: 'Coupe', durationMin: 60, priceCents: 3000 },
  })

  const member = await testDb.salonMember.create({
    data: { salonId: salon.id, displayName: 'Camille' },
  })

  const user = await testDb.user.create({
    data: {
      email: 'cliente@example.fr',
      firstName: 'Léa',
      lastName: 'Petit',
      phone: '+33600000000',
      passwordHash: 'empreinte-argon2',
    },
  })

  const appointment = await testDb.appointment.create({
    data: {
      salonId: salon.id,
      memberId: member.id,
      clientId: user.id,
      startAt: new Date('2026-09-16T10:00:00+02:00'),
      endAt: new Date('2026-09-16T11:00:00+02:00'),
      status: 'DONE',
      clientNote: 'Je suis allergique à l’ammoniaque',
      staffNote: 'Cliente difficile',
      items: {
        create: {
          salonId: salon.id,
          serviceId: service.id,
          nameSnapshot: 'Coupe',
          durationMin: 60,
          priceCents: 3000,
          position: 0,
        },
      },
    },
  })

  await testDb.consentRecord.create({
    data: {
      userId: user.id,
      type: 'TRANSACTIONAL_SMS',
      granted: true,
      source: 'inscription',
    },
  })

  const actor: Actor = { userId: user.id, role: 'CLIENT', memberships: [] }

  return { salon, service, member, user, appointment, actor }
}

describe('droits des personnes', () => {
  beforeEach(async () => {
    await resetDatabase()
  })

  afterAll(async () => {
    await testDb.$disconnect()
  })

  describe('droit d’accès', () => {
    it('should export the account details', async () => {
      const { actor } = await fixture()

      const data = await exportPersonalData(actor)

      expect(data.account.email).toBe('cliente@example.fr')
      expect(data.account.firstName).toBe('Léa')
      expect(data.account.phone).toBe('+33600000000')
    })

    it('should export appointments with their services', async () => {
      const { actor } = await fixture()

      const data = await exportPersonalData(actor)

      expect(data.appointments).toHaveLength(1)
      expect(data.appointments[0]?.services).toEqual(['Coupe'])
      expect(data.appointments[0]?.totalCents).toBe(3000)
      expect(data.appointments[0]?.clientNote).toContain('ammoniaque')
    })

    it('should export the consent history', async () => {
      const { actor } = await fixture()

      const data = await exportPersonalData(actor)

      expect(data.consents).toHaveLength(1)
      expect(data.consents[0]?.granted).toBe(true)
    })

    it('should never export the internal notes of the salon', async () => {
      // Elles appartiennent au salon et peuvent contenir des appréciations
      // professionnelles : le droit d'accès ne les couvre pas.
      const { actor } = await fixture()

      const data = await exportPersonalData(actor)

      expect(JSON.stringify(data)).not.toContain('Cliente difficile')
    })

    it('should never export the password hash', async () => {
      const { actor } = await fixture()

      expect(JSON.stringify(await exportPersonalData(actor))).not.toContain('argon2')
    })
  })

  describe('droit à l’effacement', () => {
    it('should erase the identity of the account', async () => {
      const { actor, user } = await fixture()

      await eraseAccount(actor)

      const erased = await testDb.user.findUniqueOrThrow({ where: { id: user.id } })
      expect(erased.email).not.toContain('cliente@example.fr')
      expect(erased.firstName).toBeNull()
      expect(erased.lastName).toBeNull()
      expect(erased.phone).toBeNull()
      expect(erased.passwordHash).toBeNull()
      expect(erased.deletedAt).not.toBeNull()
    })

    it('should keep the appointments, detached from any identity', async () => {
      // Le salon doit pouvoir justifier son activité passée.
      const { actor, appointment } = await fixture()

      await eraseAccount(actor)

      const kept = await testDb.appointment.findUniqueOrThrow({
        where: { id: appointment.id },
      })
      expect(kept.status).toBe('DONE')
      // La note du client pouvait contenir des éléments personnels.
      expect(kept.clientNote).toBeNull()
    })

    it('should keep the revenue figures of the salon intact', async () => {
      const { actor, salon } = await fixture()

      await eraseAccount(actor)

      const items = await testDb.appointmentItem.findMany({
        where: { salonId: salon.id },
      })
      expect(items).toHaveLength(1)
      expect(items[0]?.priceCents).toBe(3000)
    })

    it('should revoke every session immediately', async () => {
      const { actor, user } = await fixture()
      const token = await createSession(user.id)
      expect(await resolveSession(token)).not.toBeNull()

      await eraseAccount(actor)

      expect(await resolveSession(token)).toBeNull()
    })

    it('should delete the consent records', async () => {
      // Sans personne à protéger, le registre n'a plus d'objet.
      const { actor } = await fixture()

      await eraseAccount(actor)

      expect(await testDb.consentRecord.count()).toBe(0)
    })

    it('should produce a unique anonymous email', async () => {
      const { actor, user } = await fixture()

      await eraseAccount(actor)

      const erased = await testDb.user.findUniqueOrThrow({ where: { id: user.id } })
      expect(erased.email).toMatch(/^anonyme-[0-9a-f]{16}@supprime\.invalid$/)
    })

    it('should refuse to erase an active salon member', async () => {
      // Anonymiser un gérant laisserait son salon sans responsable.
      const { salon, user } = await fixture()
      await testDb.salonMember.create({
        data: { salonId: salon.id, userId: user.id, role: 'OWNER', displayName: 'Léa' },
      })
      const actor: Actor = { userId: user.id, role: 'CLIENT', memberships: [] }

      await expect(eraseAccount(actor)).rejects.toThrow(ActiveMembershipError)

      // Rien n'a bougé.
      const untouched = await testDb.user.findUniqueOrThrow({ where: { id: user.id } })
      expect(untouched.firstName).toBe('Léa')
    })
  })

  describe('durées de conservation', () => {
    it('should delete appointments older than three years', async () => {
      const { salon, member } = await fixture()
      await testDb.appointment.create({
        data: {
          salonId: salon.id,
          memberId: member.id,
          startAt: new Date('2022-01-01T10:00:00+01:00'),
          endAt: new Date('2022-01-01T11:00:00+01:00'),
          status: 'DONE',
        },
      })

      const report = await purgeExpiredData(NOW)

      expect(report.appointments).toBe(1)
      // Le rendez-vous récent est conservé.
      expect(await testDb.appointment.count()).toBe(1)
    })

    it('should delete notification logs older than a year', async () => {
      const { salon, appointment } = await fixture()
      await testDb.notificationLog.create({
        data: {
          salonId: salon.id,
          appointmentId: appointment.id,
          channel: 'EMAIL',
          template: 'reminder_j1',
          recipientHash: 'a'.repeat(64),
          idempotencyKey: 'vieux',
          status: 'SENT',
          createdAt: new Date('2024-01-01T00:00:00Z'),
        },
      })

      const report = await purgeExpiredData(NOW)

      expect(report.notifications).toBe(1)
    })

    it('should delete anonymised accounts without appointments', async () => {
      await testDb.user.create({
        data: {
          email: 'anonyme-vieux@supprime.invalid',
          deletedAt: new Date('2024-01-01T00:00:00Z'),
        },
      })

      const report = await purgeExpiredData(NOW)

      expect(report.accounts).toBe(1)
    })

    it('should keep an anonymised account that still has appointments', async () => {
      // Supprimer le compte casserait la clé étrangère des rendez-vous.
      const { actor } = await fixture()
      await eraseAccount(actor)
      await testDb.user.update({
        where: { id: actor.userId },
        data: { deletedAt: new Date('2024-01-01T00:00:00Z') },
      })

      const report = await purgeExpiredData(NOW)

      expect(report.accounts).toBe(0)
    })

    it('should be idempotent', async () => {
      // Le job tourne chaque nuit : un second passage ne doit rien trouver.
      const { salon, member } = await fixture()
      await testDb.appointment.create({
        data: {
          salonId: salon.id,
          memberId: member.id,
          startAt: new Date('2022-01-01T10:00:00+01:00'),
          endAt: new Date('2022-01-01T11:00:00+01:00'),
        },
      })

      await purgeExpiredData(NOW)
      const second = await purgeExpiredData(NOW)

      expect(second.appointments).toBe(0)
    })
  })

  describe('invitations d’équipe', () => {
    it('should include received invitations in the export', async () => {
      const { user, actor, salon } = await fixture()
      const member = await testDb.salonMember.create({
        data: { salonId: salon.id, displayName: 'Recrue' },
      })
      await testDb.salonInvitation.create({
        data: {
          salonId: salon.id,
          memberId: member.id,
          email: user.email,
          tokenHash: 'empreinte-test',
          expiresAt: new Date(Date.now() + 7 * 24 * 3_600_000),
        },
      })

      const exported = await exportPersonalData(actor)

      expect(exported.invitations).toHaveLength(1)
      expect(exported.invitations[0]?.salon).toBe(salon.name)
    })

    it('should neutralise the address on erasure without losing the invitation', async () => {
      // L'adresse en clair survivait à l'effacement. Le salon garde trace
      // d'avoir invité quelqu'un, sans de quoi le recontacter.
      const { user, actor, salon } = await fixture()
      const member = await testDb.salonMember.create({
        data: { salonId: salon.id, displayName: 'Recrue' },
      })
      const invitation = await testDb.salonInvitation.create({
        data: {
          salonId: salon.id,
          memberId: member.id,
          email: user.email,
          tokenHash: 'empreinte-effacement',
          expiresAt: new Date(Date.now() + 7 * 24 * 3_600_000),
        },
      })

      await eraseAccount(actor)

      const row = await testDb.salonInvitation.findUniqueOrThrow({
        where: { id: invitation.id },
      })
      expect(row.email).not.toBe(user.email)
      expect(row.email).not.toContain('@example')
      // Le jeton est régénéré : un lien intercepté avant l'effacement ne doit
      // plus rien ouvrir.
      expect(row.tokenHash).not.toBe('empreinte-effacement')
    })
  })

  describe('purge', () => {
    it('should delete sessions that expired and were never resumed', async () => {
      // Elles sont supprimées à la lecture, mais celles d'un compte qui ne
      // revient jamais restaient indéfiniment, chacune portant un userId.
      const { user } = await fixture()
      await testDb.session.create({
        data: {
          userId: user.id,
          sessionToken: 'jeton-perime',
          expires: new Date(Date.now() - 86_400_000),
        },
      })

      const report = await purgeExpiredData()

      expect(report.sessions).toBeGreaterThanOrEqual(1)
      expect(await testDb.session.count({ where: { userId: user.id } })).toBe(0)
    })

    it('should keep a session that is still valid', async () => {
      const { user } = await fixture()
      await testDb.session.create({
        data: {
          userId: user.id,
          sessionToken: 'jeton-valide',
          expires: new Date(Date.now() + 86_400_000),
        },
      })

      await purgeExpiredData()

      expect(await testDb.session.count({ where: { userId: user.id } })).toBe(1)
    })

    it('should purge long-expired invitations', async () => {
      const { salon } = await fixture()
      const member = await testDb.salonMember.create({
        data: { salonId: salon.id, displayName: 'Jamais venu' },
      })
      await testDb.salonInvitation.create({
        data: {
          salonId: salon.id,
          memberId: member.id,
          email: 'jamais.venu@example.fr',
          tokenHash: 'empreinte-ancienne',
          // Expirée depuis six mois.
          expiresAt: new Date(Date.now() - 180 * 86_400_000),
        },
      })

      const report = await purgeExpiredData()

      expect(report.invitations).toBe(1)
    })

    it('should keep an accepted invitation whatever its age', async () => {
      // Elle atteste du rattachement d'un compte à une fiche : sa suppression
      // effacerait cette trace du journal du salon.
      const { salon } = await fixture()
      const member = await testDb.salonMember.create({
        data: { salonId: salon.id, displayName: 'Arrivé' },
      })
      await testDb.salonInvitation.create({
        data: {
          salonId: salon.id,
          memberId: member.id,
          email: 'arrive@example.fr',
          tokenHash: 'empreinte-acceptee',
          status: 'ACCEPTED',
          acceptedAt: new Date(Date.now() - 200 * 86_400_000),
          expiresAt: new Date(Date.now() - 180 * 86_400_000),
        },
      })

      const report = await purgeExpiredData()

      expect(report.invitations).toBe(0)
    })
  })
})
