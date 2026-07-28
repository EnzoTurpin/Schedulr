import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { getAvailability } from '@/features/availability'
import { clearCache } from '@/features/availability/cache'
import {
  createCategory,
  createService,
  deleteCategory,
  listCatalog,
  setServiceActive,
  updateService,
} from '@/features/salon-admin/services'
import {
  InvalidScheduleError,
  countAffectedAppointments,
  createClosure,
  getOpeningHours,
  replaceOpeningHours,
  validateDayRanges,
} from '@/features/salon-admin/schedule'
import {
  createMember,
  createTimeOff,
  deactivateMember,
  listTeam,
  replaceWorkingHours,
  setMemberServices,
  setServiceOverride,
  updateMember,
} from '@/features/salon-admin/team'
import {
  InvalidSettingsError,
  updateBookingSettings,
  updateSalonProfile,
  validateBookingSettings,
} from '@/features/salon-admin/settings'
import { createSession, resolveSession } from '@/lib/auth/session'
import { ForbiddenError, ResourceNotFoundError, type Actor } from '@/lib/authz/types'
import { resetDatabase, testDb } from './helpers/db'

/**
 * Configuration du salon.
 *
 * Deux enjeux transverses, vérifiés partout : le cloisonnement — une
 * configuration ne doit jamais atteindre un salon voisin — et l'invalidation du
 * cache de disponibilité, sans laquelle un changement d'horaire resterait
 * invisible aux clients (ADR-0003).
 */

const h = (hours: number) => hours * 60
const WEDNESDAY = 3

async function fixture(slug = 'salon-config') {
  const salon = await testDb.salon.create({
    data: {
      slug,
      name: `Salon ${slug}`,
      address: '1 rue des Tests',
      city: 'Lyon',
      postalCode: '69000',
      isActive: true,
      slotStepMin: 30,
      bookingLeadTimeMin: 0,
      openingHours: { create: [{ dayOfWeek: WEDNESDAY, startMin: h(9), endMin: h(19) }] },
    },
  })

  const service = await testDb.service.create({
    data: { salonId: salon.id, name: 'Coupe', durationMin: 60, priceCents: 3000 },
  })

  const ownerUser = await testDb.user.create({
    data: { email: `owner-${slug}@example.fr`, firstName: 'Julie', lastName: 'Roux' },
  })
  const member = await testDb.salonMember.create({
    data: {
      salonId: salon.id,
      userId: ownerUser.id,
      role: 'OWNER',
      displayName: 'Julie',
      workingHours: {
        create: [
          { salonId: salon.id, dayOfWeek: WEDNESDAY, startMin: h(9), endMin: h(19) },
        ],
      },
      services: { create: [{ salonId: salon.id, serviceId: service.id }] },
    },
  })

  const owner: Actor = {
    userId: ownerUser.id,
    role: 'CLIENT',
    memberships: [
      { salonId: salon.id, memberId: member.id, role: 'OWNER', isActive: true },
    ],
  }

  return { salon, service, member, owner, ownerUser }
}

/** Acteur coiffeur, sans droits de configuration. */
async function staffActor(salonId: string, memberId: string): Promise<Actor> {
  const user = await testDb.user.create({
    data: { email: `staff-${memberId}@example.fr`, firstName: 'Sofia', lastName: 'N' },
  })
  return {
    userId: user.id,
    role: 'CLIENT',
    memberships: [{ salonId, memberId, role: 'STAFF', isActive: true }],
  }
}

describe('configuration du salon', () => {
  beforeEach(async () => {
    await resetDatabase()
    clearCache()
  })

  afterAll(async () => {
    await testDb.$disconnect()
  })

  describe('catalogue', () => {
    it('should create a category and append it at the end', async () => {
      const { salon, owner } = await fixture()

      await createCategory(owner, salon.id, 'Coupe')
      const second = await createCategory(owner, salon.id, 'Couleur')

      expect(second.position).toBe(1)
    })

    it('should create a service', async () => {
      const { salon, owner } = await fixture()

      await createService(owner, salon.id, {
        name: 'Balayage',
        durationMin: 90,
        bufferBeforeMin: 0,
        bufferAfterMin: 15,
        priceCents: 9500,
      })

      const { services } = await listCatalog(owner, salon.id)
      expect(services.map((s) => s.name)).toContain('Balayage')
    })

    it('should refuse a category from another salon', async () => {
      const a = await fixture('salon-a')
      const b = await fixture('salon-b')
      const foreign = await createCategory(b.owner, b.salon.id, 'Ailleurs')

      await expect(
        createService(a.owner, a.salon.id, {
          name: 'Coupe',
          categoryId: foreign.id,
          durationMin: 30,
          bufferBeforeMin: 0,
          bufferAfterMin: 0,
          priceCents: 2000,
        }),
      ).rejects.toThrow(ResourceNotFoundError)
    })

    it('should keep services when their category is deleted', async () => {
      // Supprimer une rubrique ne doit pas faire disparaître le catalogue.
      const { salon, owner } = await fixture()
      const category = await createCategory(owner, salon.id, 'Coupe')
      await createService(owner, salon.id, {
        name: 'Coupe femme',
        categoryId: category.id,
        durationMin: 45,
        bufferBeforeMin: 0,
        bufferAfterMin: 0,
        priceCents: 3500,
      })

      await deleteCategory(owner, salon.id, category.id)

      const { services, categories } = await listCatalog(owner, salon.id)
      expect(categories).toHaveLength(0)
      expect(services.map((s) => s.name)).toContain('Coupe femme')
    })

    it('should refuse catalogue management to a staff member', async () => {
      const { salon, member, owner: _owner } = await fixture()
      const staff = await staffActor(salon.id, member.id)

      await expect(createCategory(staff, salon.id, 'Interdit')).rejects.toThrow(
        ForbiddenError,
      )
    })

    it('should not expose the catalogue of another salon', async () => {
      const a = await fixture('salon-a')
      await fixture('salon-b')

      const { services } = await listCatalog(a.owner, a.salon.id)

      expect(services).toHaveLength(1)
      expect(services[0]?.name).toBe('Coupe')
    })

    describe('effet sur les disponibilités', () => {
      const query = (salonId: string, serviceId: string) => ({
        salonId,
        serviceIds: [serviceId],
        memberId: null,
        from: new Date('2026-07-15T00:00:00+02:00'),
        to: new Date('2026-07-15T23:59:00+02:00'),
        now: new Date('2026-07-01T10:00:00+02:00'),
      })

      it('should shift the offered slots when the duration changes', async () => {
        const { salon, service, owner } = await fixture()
        const before = await getAvailability(query(salon.id, service.id))

        await updateService(owner, salon.id, service.id, {
          name: 'Coupe',
          durationMin: 120,
          bufferBeforeMin: 0,
          bufferAfterMin: 0,
          priceCents: 3000,
        })

        // Le cache doit avoir été vidé : sans cela, la liste serait inchangée.
        const after = await getAvailability(query(salon.id, service.id))
        expect(after.slots.length).toBeLessThan(before.slots.length)
      })

      it('should remove a deactivated service from the booking flow', async () => {
        const { salon, service, owner } = await fixture()

        await setServiceActive(owner, salon.id, service.id, false)

        await expect(getAvailability(query(salon.id, service.id))).rejects.toThrow()
      })
    })
  })

  describe('horaires d’ouverture', () => {
    it('should reject a range ending before it starts', () => {
      expect(() => validateDayRanges([{ startMin: h(19), endMin: h(9) }])).toThrow(
        InvalidScheduleError,
      )
    })

    it('should reject two overlapping ranges on the same day', () => {
      // 9 h–14 h puis 12 h–19 h : saisie incohérente que le moteur fusionnerait
      // en silence.
      expect(() =>
        validateDayRanges([
          { startMin: h(9), endMin: h(14) },
          { startMin: h(12), endMin: h(19) },
        ]),
      ).toThrow(/chevauchent/)
    })

    it('should accept a lunch break', () => {
      expect(() =>
        validateDayRanges([
          { startMin: h(9), endMin: h(12) },
          { startMin: h(14), endMin: h(19) },
        ]),
      ).not.toThrow()
    })

    it('should accept two ranges that merely touch', () => {
      expect(() =>
        validateDayRanges([
          { startMin: h(9), endMin: h(12) },
          { startMin: h(12), endMin: h(19) },
        ]),
      ).not.toThrow()
    })

    it('should replace the whole week', async () => {
      const { salon, owner } = await fixture()

      await replaceOpeningHours(owner, salon.id, {
        2: [{ startMin: h(10), endMin: h(18) }],
        3: [
          { startMin: h(9), endMin: h(12) },
          { startMin: h(14), endMin: h(19) },
        ],
      })

      const week = await getOpeningHours(owner, salon.id)
      expect(week[2]).toHaveLength(1)
      expect(week[3]).toHaveLength(2)
    })

    it('should allow closing every day', async () => {
      const { salon, owner } = await fixture()

      await replaceOpeningHours(owner, salon.id, {})

      expect(await getOpeningHours(owner, salon.id)).toEqual({})
    })

    it('should not touch the opening hours of another salon', async () => {
      const a = await fixture('salon-a')
      const b = await fixture('salon-b')

      await replaceOpeningHours(a.owner, a.salon.id, {})

      expect(Object.keys(await getOpeningHours(b.owner, b.salon.id))).toHaveLength(1)
    })
  })

  describe('fermetures exceptionnelles', () => {
    it('should create a closure', async () => {
      const { salon, owner } = await fixture()

      const closure = await createClosure(owner, salon.id, {
        startAt: new Date('2026-08-01T00:00:00+02:00'),
        endAt: new Date('2026-08-15T00:00:00+02:00'),
        reason: 'Congés annuels',
      })

      expect(closure.reason).toBe('Congés annuels')
    })

    it('should reject a closure ending before it starts', async () => {
      const { salon, owner } = await fixture()

      await expect(
        createClosure(owner, salon.id, {
          startAt: new Date('2026-08-15T00:00:00+02:00'),
          endAt: new Date('2026-08-01T00:00:00+02:00'),
        }),
      ).rejects.toThrow(InvalidScheduleError)
    })

    it('should count the appointments a closure would invalidate', async () => {
      // Fermer une journée déjà réservée est légitime, mais le gérant doit
      // savoir combien de clients prévenir.
      const { salon, member, owner } = await fixture()
      await testDb.appointment.create({
        data: {
          salonId: salon.id,
          memberId: member.id,
          startAt: new Date('2026-08-05T14:00:00+02:00'),
          endAt: new Date('2026-08-05T15:00:00+02:00'),
        },
      })

      const affected = await countAffectedAppointments(owner, salon.id, {
        startAt: new Date('2026-08-01T00:00:00+02:00'),
        endAt: new Date('2026-08-15T00:00:00+02:00'),
      })

      expect(affected).toBe(1)
    })

    it('should ignore cancelled appointments in the count', async () => {
      const { salon, member, owner } = await fixture()
      await testDb.appointment.create({
        data: {
          salonId: salon.id,
          memberId: member.id,
          status: 'CANCELLED',
          startAt: new Date('2026-08-05T14:00:00+02:00'),
          endAt: new Date('2026-08-05T15:00:00+02:00'),
        },
      })

      expect(
        await countAffectedAppointments(owner, salon.id, {
          startAt: new Date('2026-08-01T00:00:00+02:00'),
          endAt: new Date('2026-08-15T00:00:00+02:00'),
        }),
      ).toBe(0)
    })
  })

  describe('équipe', () => {
    it('should create a member without a user account', async () => {
      // Le salon crée la fiche du coiffeur avant qu'il ait un compte.
      const { salon, owner } = await fixture()

      const created = await createMember(owner, salon.id, {
        displayName: 'Sofia',
        color: '#14b8a6',
        role: 'STAFF',
        isBookable: true,
      })

      const team = await listTeam(owner, salon.id)
      const sofia = team.find((m) => m.id === created.id)
      expect(sofia?.userId).toBeNull()
      expect(sofia?.isActive).toBe(true)
    })

    it('should refuse an owner demoting themselves', async () => {
      // Sans cette garde, le salon se retrouverait sans personne pour gérer
      // l'équipe.
      const { salon, member, owner } = await fixture()

      await expect(
        updateMember(owner, salon.id, member.id, {
          displayName: 'Julie',
          color: '#8b5cf6',
          role: 'STAFF',
          isBookable: true,
        }),
      ).rejects.toThrow(ForbiddenError)
    })

    it('should refuse deactivating the last active owner', async () => {
      const { salon, member, owner } = await fixture()

      await expect(deactivateMember(owner, salon.id, member.id)).rejects.toThrow(
        ForbiddenError,
      )
    })

    it('should deactivate a member and revoke their sessions', async () => {
      // C'est la raison d'être des sessions en base (ADR-0001) : l'accès tombe
      // immédiatement, pas à l'expiration d'un jeton.
      const { salon, owner } = await fixture()
      const user = await testDb.user.create({
        data: { email: 'partant@example.fr', firstName: 'Marc', lastName: 'L' },
      })
      const leaving = await testDb.salonMember.create({
        data: { salonId: salon.id, userId: user.id, displayName: 'Marc', role: 'STAFF' },
      })
      const token = await createSession(user.id)
      expect(await resolveSession(token)).not.toBeNull()

      await deactivateMember(owner, salon.id, leaving.id)

      expect(await resolveSession(token)).toBeNull()
    })

    it('should record an audit entry when deactivating a member', async () => {
      const { salon, owner } = await fixture()
      const leaving = await createMember(owner, salon.id, {
        displayName: 'Marc',
        color: '#f59e0b',
        role: 'STAFF',
        isBookable: true,
      })

      await deactivateMember(owner, salon.id, leaving.id)

      const log = await testDb.auditLog.findFirstOrThrow({
        where: { action: 'member.deactivated' },
      })
      expect(log.targetId).toBe(leaving.id)
    })

    it('should replace the working hours of a member', async () => {
      const { salon, member, owner } = await fixture()

      await replaceWorkingHours(owner, salon.id, member.id, {
        1: [{ startMin: h(10), endMin: h(16) }],
      })

      const team = await listTeam(owner, salon.id)
      const updated = team.find((m) => m.id === member.id)
      expect(updated?.workingHours).toHaveLength(1)
      expect(updated?.workingHours[0]?.dayOfWeek).toBe(1)
    })

    it('should reject overlapping working hours', async () => {
      const { salon, member, owner } = await fixture()

      await expect(
        replaceWorkingHours(owner, salon.id, member.id, {
          1: [
            { startMin: h(9), endMin: h(14) },
            { startMin: h(12), endMin: h(18) },
          ],
        }),
      ).rejects.toThrow(InvalidScheduleError)
    })

    it('should set the services a member performs', async () => {
      const { salon, member, owner } = await fixture()
      const second = await createService(owner, salon.id, {
        name: 'Couleur',
        durationMin: 90,
        bufferBeforeMin: 0,
        bufferAfterMin: 0,
        priceCents: 6000,
      })

      await setMemberServices(owner, salon.id, member.id, [second.id])

      const team = await listTeam(owner, salon.id)
      const updated = team.find((m) => m.id === member.id)
      expect(updated?.services.map((s) => s.serviceId)).toEqual([second.id])
    })

    it('should preserve the price override of a kept service', async () => {
      // Retirer puis remettre une prestation ne doit pas effacer le tarif
      // particulier d'un coiffeur.
      const { salon, service, member, owner } = await fixture()
      await setServiceOverride(owner, salon.id, member.id, service.id, {
        durationMin: null,
        priceCents: 4200,
      })

      await setMemberServices(owner, salon.id, member.id, [service.id])

      const link = await testDb.staffService.findUniqueOrThrow({
        where: { memberId_serviceId: { memberId: member.id, serviceId: service.id } },
      })
      expect(link.priceCents).toBe(4200)
    })

    it('should refuse assigning a service from another salon', async () => {
      const a = await fixture('salon-a')
      const b = await fixture('salon-b')

      await expect(
        setMemberServices(a.owner, a.salon.id, a.member.id, [b.service.id]),
      ).rejects.toThrow(ResourceNotFoundError)
    })

    it('should let a staff member book their own time off', async () => {
      const { salon, member } = await fixture()
      const staff = await staffActor(salon.id, member.id)

      await expect(
        createTimeOff(staff, salon.id, {
          memberId: member.id,
          startAt: new Date('2026-08-01T00:00:00+02:00'),
          endAt: new Date('2026-08-08T00:00:00+02:00'),
          reason: 'Congés',
        }),
      ).resolves.toBeDefined()
    })

    it('should refuse a staff member booking time off for a colleague', async () => {
      const { salon, member, owner } = await fixture()
      const colleague = await createMember(owner, salon.id, {
        displayName: 'Alex',
        color: '#ec4899',
        role: 'STAFF',
        isBookable: true,
      })
      const staff = await staffActor(salon.id, member.id)

      await expect(
        createTimeOff(staff, salon.id, {
          memberId: colleague.id,
          startAt: new Date('2026-08-01T00:00:00+02:00'),
          endAt: new Date('2026-08-08T00:00:00+02:00'),
        }),
      ).rejects.toThrow(ForbiddenError)
    })
  })

  describe('fiche et paramètres', () => {
    it('should update the salon profile', async () => {
      const { salon, owner } = await fixture()

      await updateSalonProfile(owner, salon.id, {
        name: 'Nouveau nom',
        description: 'Salon rénové',
        address: '2 place Bellecour',
        city: 'Lyon',
        postalCode: '69002',
        phone: '+33478000000',
      })

      const updated = await testDb.salon.findUniqueOrThrow({ where: { id: salon.id } })
      expect(updated.name).toBe('Nouveau nom')
      expect(updated.postalCode).toBe('69002')
    })

    it('should refuse profile updates from a staff member', async () => {
      const { salon, member } = await fixture()
      const staff = await staffActor(salon.id, member.id)

      await expect(
        updateSalonProfile(staff, salon.id, {
          name: 'Piraté',
          address: 'x',
          city: 'Lyon',
          postalCode: '69000',
        }),
      ).rejects.toThrow(ForbiddenError)
    })

    it('should accept valid booking settings', () => {
      expect(() =>
        validateBookingSettings({
          bookingLeadTimeMin: 120,
          bookingHorizonDays: 60,
          slotStepMin: 15,
          cancellationDeadlineHours: 24,
        }),
      ).not.toThrow()
    })

    it('should reject a slot step outside the allowed values', () => {
      expect(() =>
        validateBookingSettings({
          bookingLeadTimeMin: 0,
          bookingHorizonDays: 60,
          slotStepMin: 7,
          cancellationDeadlineHours: 24,
        }),
      ).toThrow(InvalidSettingsError)
    })

    it('should reject a lead time exceeding the horizon', () => {
      // Aucun créneau ne serait jamais proposé.
      expect(() =>
        validateBookingSettings({
          bookingLeadTimeMin: 3 * 24 * 60,
          bookingHorizonDays: 2,
          slotStepMin: 15,
          cancellationDeadlineHours: 24,
        }),
      ).toThrow(/aucun créneau/)
    })

    it('should reject a zero horizon', () => {
      expect(() =>
        validateBookingSettings({
          bookingLeadTimeMin: 0,
          bookingHorizonDays: 0,
          slotStepMin: 15,
          cancellationDeadlineHours: 24,
        }),
      ).toThrow(InvalidSettingsError)
    })

    it('should apply a new slot step to the offered slots', async () => {
      const { salon, service, owner } = await fixture()
      const query = {
        salonId: salon.id,
        serviceIds: [service.id],
        memberId: null,
        from: new Date('2026-07-15T00:00:00+02:00'),
        to: new Date('2026-07-15T23:59:00+02:00'),
        now: new Date('2026-07-01T10:00:00+02:00'),
      }
      const before = await getAvailability(query)

      await updateBookingSettings(owner, salon.id, {
        bookingLeadTimeMin: 0,
        bookingHorizonDays: 60,
        slotStepMin: 15,
        cancellationDeadlineHours: 24,
      })

      const after = await getAvailability(query)
      expect(after.slots.length).toBeGreaterThan(before.slots.length)
    })
  })
})
