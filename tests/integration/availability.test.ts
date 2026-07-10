import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { formatInTimeZone } from 'date-fns-tz'
import {
  SalonNotBookableError,
  getAvailability,
  invalidateSalon,
} from '@/features/availability'
import { clearCache } from '@/features/availability/cache'
import { resetDatabase, testDb } from './helpers/db'

/**
 * Moteur de disponibilité de bout en bout : chargement Prisma, calcul, cache.
 *
 * Complète les tests unitaires du moteur — qui couvrent l'algorithme — en
 * vérifiant ce qu'eux ne peuvent pas voir : le cloisonnement par salon, les
 * durées par coiffeur lues en base, et l'effet réel du cache.
 */

const PARIS = 'Europe/Paris'
const h = (hours: number) => hours * 60

/** Mercredi 15 juillet 2026. */
const WEDNESDAY_DOW = 3
const DAY_START = new Date('2026-07-15T00:00:00+02:00')
const DAY_END = new Date('2026-07-15T23:59:00+02:00')
const NOW = new Date('2026-07-01T10:00:00+02:00')

const at = (slots: { startAt: number }[]) =>
  slots.map((s) => formatInTimeZone(s.startAt, PARIS, 'HH:mm'))

async function buildSalon(slug = 'salon-dispo') {
  const salon = await testDb.salon.create({
    data: {
      slug,
      name: slug,
      address: '1 rue des Tests',
      city: 'Lyon',
      postalCode: '69000',
      isActive: true,
      slotStepMin: 30,
      bookingLeadTimeMin: 0,
      openingHours: {
        create: [{ dayOfWeek: WEDNESDAY_DOW, startMin: h(9), endMin: h(19) }],
      },
    },
  })

  const service = await testDb.service.create({
    data: { salonId: salon.id, name: 'Coupe', durationMin: 60, priceCents: 3000 },
  })

  const member = await testDb.salonMember.create({
    data: {
      salonId: salon.id,
      displayName: 'Camille',
      workingHours: {
        create: [
          { salonId: salon.id, dayOfWeek: WEDNESDAY_DOW, startMin: h(9), endMin: h(19) },
        ],
      },
      services: { create: [{ salonId: salon.id, serviceId: service.id }] },
    },
  })

  return { salon, service, member }
}

const query = (
  salonId: string,
  serviceIds: string[],
  memberId: string | null = null,
) => ({
  salonId,
  serviceIds,
  memberId,
  from: DAY_START,
  to: DAY_END,
  now: NOW,
})

describe('disponibilités de bout en bout', () => {
  beforeEach(async () => {
    await resetDatabase()
    clearCache()
  })

  afterAll(async () => {
    await testDb.$disconnect()
  })

  it('should compute slots from data stored in database', async () => {
    const { salon, service } = await buildSalon()

    const result = await getAvailability(query(salon.id, [service.id]), { cache: false })

    expect(at(result.slots)[0]).toBe('09:00')
    expect(at(result.slots).at(-1)).toBe('18:00')
  })

  it('should exclude a slot already booked', async () => {
    const { salon, service, member } = await buildSalon()
    await testDb.appointment.create({
      data: {
        salonId: salon.id,
        memberId: member.id,
        startAt: new Date('2026-07-15T14:00:00+02:00'),
        endAt: new Date('2026-07-15T15:00:00+02:00'),
      },
    })

    const result = await getAvailability(query(salon.id, [service.id]), { cache: false })

    expect(at(result.slots)).not.toContain('14:00')
    expect(at(result.slots)).toContain('15:00')
  })

  it('should ignore a cancelled appointment', async () => {
    // Le moteur ne retient que les statuts actifs, comme la contrainte
    // d'exclusion en base (ADR-0004).
    const { salon, service, member } = await buildSalon()
    await testDb.appointment.create({
      data: {
        salonId: salon.id,
        memberId: member.id,
        status: 'CANCELLED',
        startAt: new Date('2026-07-15T14:00:00+02:00'),
        endAt: new Date('2026-07-15T15:00:00+02:00'),
      },
    })

    const result = await getAvailability(query(salon.id, [service.id]), { cache: false })

    expect(at(result.slots)).toContain('14:00')
  })

  it('should apply a staff-specific duration override', async () => {
    const { salon, service, member } = await buildSalon()
    await testDb.staffService.update({
      where: { memberId_serviceId: { memberId: member.id, serviceId: service.id } },
      data: { durationMin: 120 },
    })

    const result = await getAvailability(query(salon.id, [service.id]), { cache: false })

    // Deux heures : le dernier départ possible recule de 18 h à 17 h.
    expect(at(result.slots).at(-1)).toBe('17:00')
  })

  it('should add service buffers to the booked duration', async () => {
    const { salon, service } = await buildSalon()
    await testDb.service.update({
      where: { id: service.id },
      data: { bufferAfterMin: 30 },
    })

    const result = await getAvailability(query(salon.id, [service.id]), { cache: false })

    expect(at(result.slots).at(-1)).toBe('17:30')
  })

  it('should sum the duration of several services', async () => {
    const { salon, service, member } = await buildSalon()
    const second = await testDb.service.create({
      data: { salonId: salon.id, name: 'Brushing', durationMin: 30, priceCents: 2000 },
    })
    await testDb.staffService.create({
      data: { salonId: salon.id, memberId: member.id, serviceId: second.id },
    })

    const result = await getAvailability(query(salon.id, [service.id, second.id]), {
      cache: false,
    })

    // 60 + 30 = 90 min : dernier départ à 17 h 30.
    expect(at(result.slots).at(-1)).toBe('17:30')
  })

  it('should only keep hairdressers performing every requested service', async () => {
    const { salon, service, member } = await buildSalon()
    const second = await testDb.service.create({
      data: { salonId: salon.id, name: 'Couleur', durationMin: 60, priceCents: 6000 },
    })
    // Camille ne fait pas la couleur ; Alex fait les deux.
    const alex = await testDb.salonMember.create({
      data: {
        salonId: salon.id,
        displayName: 'Alex',
        workingHours: {
          create: [
            {
              salonId: salon.id,
              dayOfWeek: WEDNESDAY_DOW,
              startMin: h(9),
              endMin: h(19),
            },
          ],
        },
        services: {
          create: [
            { salonId: salon.id, serviceId: service.id },
            { salonId: salon.id, serviceId: second.id },
          ],
        },
      },
    })

    const result = await getAvailability(query(salon.id, [service.id, second.id]), {
      cache: false,
    })

    expect(result.byStaff.map((s) => s.memberId)).toEqual([alex.id])
    expect(result.byStaff.map((s) => s.memberId)).not.toContain(member.id)
  })

  it('should exclude a hairdresser who is not bookable', async () => {
    const { salon, service, member } = await buildSalon()
    await testDb.salonMember.update({
      where: { id: member.id },
      data: { isBookable: false },
    })

    const result = await getAvailability(query(salon.id, [service.id]), { cache: false })

    expect(result.slots).toEqual([])
  })

  it('should exclude a deactivated hairdresser', async () => {
    const { salon, service, member } = await buildSalon()
    await testDb.salonMember.update({
      where: { id: member.id },
      data: { isActive: false },
    })

    const result = await getAvailability(query(salon.id, [service.id]), { cache: false })

    expect(result.slots).toEqual([])
  })

  it('should remove slots covered by a salon closure', async () => {
    const { salon, service } = await buildSalon()
    await testDb.closure.create({
      data: {
        salonId: salon.id,
        startAt: new Date('2026-07-15T00:00:00+02:00'),
        endAt: new Date('2026-07-16T00:00:00+02:00'),
        reason: 'Jour férié',
      },
    })

    const result = await getAvailability(query(salon.id, [service.id]), { cache: false })

    expect(result.slots).toEqual([])
  })

  it('should remove slots covered by a time off', async () => {
    const { salon, service, member } = await buildSalon()
    await testDb.timeOff.create({
      data: {
        salonId: salon.id,
        memberId: member.id,
        startAt: new Date('2026-07-15T00:00:00+02:00'),
        endAt: new Date('2026-07-15T13:00:00+02:00'),
      },
    })

    const result = await getAvailability(query(salon.id, [service.id]), { cache: false })

    expect(at(result.slots)[0]).toBe('13:00')
  })

  describe('cloisonnement par salon', () => {
    it('should refuse a service belonging to another salon', async () => {
      const a = await buildSalon('salon-a')
      const b = await buildSalon('salon-b')

      await expect(
        getAvailability(query(a.salon.id, [b.service.id]), { cache: false }),
      ).rejects.toThrow(SalonNotBookableError)
    })

    it('should not consider a hairdresser of another salon', async () => {
      const a = await buildSalon('salon-a')
      await buildSalon('salon-b')

      const result = await getAvailability(query(a.salon.id, [a.service.id]), {
        cache: false,
      })

      expect(result.byStaff).toHaveLength(1)
      expect(result.byStaff[0]?.memberId).toBe(a.member.id)
    })

    it('should refuse an inactive salon', async () => {
      const { salon, service } = await buildSalon()
      await testDb.salon.update({ where: { id: salon.id }, data: { isActive: false } })

      await expect(
        getAvailability(query(salon.id, [service.id]), { cache: false }),
      ).rejects.toThrow(SalonNotBookableError)
    })
  })

  describe('cache', () => {
    it('should serve a repeated query from cache', async () => {
      const { salon, service, member } = await buildSalon()

      const first = await getAvailability(query(salon.id, [service.id]))
      // Écriture directe en base, sans invalidation : seul le cache peut
      // expliquer que le résultat ne bouge pas.
      await testDb.appointment.create({
        data: {
          salonId: salon.id,
          memberId: member.id,
          startAt: new Date('2026-07-15T14:00:00+02:00'),
          endAt: new Date('2026-07-15T15:00:00+02:00'),
        },
      })
      const second = await getAvailability(query(salon.id, [service.id]))

      expect(at(second.slots)).toEqual(at(first.slots))
    })

    it('should reflect the new booking once the salon cache is invalidated', async () => {
      const { salon, service, member } = await buildSalon()

      await getAvailability(query(salon.id, [service.id]))
      await testDb.appointment.create({
        data: {
          salonId: salon.id,
          memberId: member.id,
          startAt: new Date('2026-07-15T14:00:00+02:00'),
          endAt: new Date('2026-07-15T15:00:00+02:00'),
        },
      })
      invalidateSalon(salon.id)

      const result = await getAvailability(query(salon.id, [service.id]))

      expect(at(result.slots)).not.toContain('14:00')
    })

    it('should never serve professional agendas from cache', async () => {
      const { salon, service, member } = await buildSalon()

      await getAvailability(query(salon.id, [service.id]), { cache: false })
      await testDb.appointment.create({
        data: {
          salonId: salon.id,
          memberId: member.id,
          startAt: new Date('2026-07-15T14:00:00+02:00'),
          endAt: new Date('2026-07-15T15:00:00+02:00'),
        },
      })

      const result = await getAvailability(query(salon.id, [service.id]), {
        cache: false,
      })

      expect(at(result.slots)).not.toContain('14:00')
    })
  })
})
