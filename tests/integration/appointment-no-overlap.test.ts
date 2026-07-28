import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { SlotConflictError, withSlotConflictMapping } from '@/lib/db/errors'
import { createMember, createSalon, resetDatabase, testDb } from './helpers/db'

/**
 * Garde-fou de l'ADR-0004.
 *
 * ⚠️ Ce fichier est le SEUL contrôle automatisé qui détecte la disparition de la
 * contrainte d'exclusion. `pnpm db:drift` surveille la colonne générée `period`,
 * mais Prisma ne modélise pas les contraintes `EXCLUDE` : une migration qui
 * supprimerait la contrainte passerait la détection de dérive sans un mot.
 *
 * Si ces tests deviennent instables, la réponse n'est jamais de les désactiver.
 */

const HOUR = 60 * 60 * 1000

async function fixture() {
  const salon = await createSalon('salon-concurrence')
  const member = await createMember(salon.id, 'Camille')
  return { salonId: salon.id, memberId: member.id }
}

function slot(startISO: string, durationHours = 1) {
  const startAt = new Date(startISO)
  return { startAt, endAt: new Date(startAt.getTime() + durationHours * HOUR) }
}

describe('contrainte anti double-réservation', () => {
  beforeEach(async () => {
    await resetDatabase()
  })

  afterAll(async () => {
    await testDb.$disconnect()
  })

  it('should accept two consecutive appointments sharing a boundary', async () => {
    // La borne de fin est exclusive ('[)') : 14 h–15 h puis 15 h–16 h ne se
    // chevauchent pas. Avec '[]', tous les rendez-vous consécutifs seraient
    // rejetés — c'est le test qui protège ce détail.
    const { salonId, memberId } = await fixture()

    await testDb.appointment.create({
      data: { salonId, memberId, ...slot('2026-09-01T12:00:00Z') },
    })
    await testDb.appointment.create({
      data: { salonId, memberId, ...slot('2026-09-01T13:00:00Z') },
    })

    expect(await testDb.appointment.count()).toBe(2)
  })

  it('should reject an overlapping appointment for the same hairdresser', async () => {
    const { salonId, memberId } = await fixture()

    await testDb.appointment.create({
      data: { salonId, memberId, ...slot('2026-09-01T12:00:00Z') },
    })

    await expect(
      testDb.appointment.create({
        data: { salonId, memberId, ...slot('2026-09-01T12:30:00Z') },
      }),
    ).rejects.toThrow()

    expect(await testDb.appointment.count()).toBe(1)
  })

  it('should allow the same slot for two different hairdressers', async () => {
    const salon = await createSalon('salon-concurrence')
    const camille = await createMember(salon.id, 'Camille')
    const alex = await createMember(salon.id, 'Alex')

    await testDb.appointment.create({
      data: { salonId: salon.id, memberId: camille.id, ...slot('2026-09-01T12:00:00Z') },
    })
    await testDb.appointment.create({
      data: { salonId: salon.id, memberId: alex.id, ...slot('2026-09-01T12:00:00Z') },
    })

    expect(await testDb.appointment.count()).toBe(2)
  })

  it('should free the slot once the appointment is cancelled', async () => {
    // La contrainte est partielle : seuls PENDING et CONFIRMED occupent la
    // plage.
    const { salonId, memberId } = await fixture()

    const first = await testDb.appointment.create({
      data: { salonId, memberId, ...slot('2026-09-01T12:00:00Z') },
    })
    await testDb.appointment.update({
      where: { id: first.id },
      data: { status: 'CANCELLED', cancelledAt: new Date() },
    })

    const replacement = await testDb.appointment.create({
      data: { salonId, memberId, ...slot('2026-09-01T12:00:00Z') },
    })

    expect(replacement.status).toBe('CONFIRMED')
  })

  it('should free the slot when the client is marked as a no-show', async () => {
    const { salonId, memberId } = await fixture()

    const first = await testDb.appointment.create({
      data: { salonId, memberId, ...slot('2026-09-01T12:00:00Z') },
    })
    await testDb.appointment.update({
      where: { id: first.id },
      data: { status: 'NO_SHOW' },
    })

    await expect(
      testDb.appointment.create({
        data: { salonId, memberId, ...slot('2026-09-01T12:00:00Z') },
      }),
    ).resolves.toBeDefined()
  })

  it('should reject an appointment ending before it starts', async () => {
    const { salonId, memberId } = await fixture()

    await expect(
      testDb.appointment.create({
        data: {
          salonId,
          memberId,
          startAt: new Date('2026-09-01T13:00:00Z'),
          endAt: new Date('2026-09-01T12:00:00Z'),
        },
      }),
    ).rejects.toThrow()
  })

  it('should reject a zero-length appointment', async () => {
    const { salonId, memberId } = await fixture()

    await expect(
      testDb.appointment.create({
        data: {
          salonId,
          memberId,
          startAt: new Date('2026-09-01T12:00:00Z'),
          endAt: new Date('2026-09-01T12:00:00Z'),
        },
      }),
    ).rejects.toThrow()
  })

  describe('réservations concurrentes', () => {
    it('should let exactly one of two simultaneous bookings succeed', async () => {
      // Le cœur de l'ADR-0004 : les deux requêtes lisent « créneau libre »
      // avant que l'une n'écrive. Seule une contrainte portée par la base peut
      // les départager.
      const { salonId, memberId } = await fixture()
      const target = slot('2026-09-01T12:00:00Z')

      const results = await Promise.allSettled([
        testDb.appointment.create({ data: { salonId, memberId, ...target } }),
        testDb.appointment.create({ data: { salonId, memberId, ...target } }),
      ])

      const fulfilled = results.filter((r) => r.status === 'fulfilled')
      const rejected = results.filter((r) => r.status === 'rejected')

      expect(fulfilled).toHaveLength(1)
      expect(rejected).toHaveLength(1)
      expect(await testDb.appointment.count()).toBe(1)
    })

    it('should let exactly one of ten simultaneous bookings succeed', async () => {
      const { salonId, memberId } = await fixture()
      const target = slot('2026-09-01T12:00:00Z')

      const results = await Promise.allSettled(
        Array.from({ length: 10 }, () =>
          testDb.appointment.create({ data: { salonId, memberId, ...target } }),
        ),
      )

      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
      expect(await testDb.appointment.count()).toBe(1)
    })
  })

  describe('traduction en erreur métier', () => {
    it('should map an exclusion violation to SlotConflictError', async () => {
      const { salonId, memberId } = await fixture()
      const target = slot('2026-09-01T12:00:00Z')

      await testDb.appointment.create({ data: { salonId, memberId, ...target } })

      await expect(
        withSlotConflictMapping(() =>
          testDb.appointment.create({ data: { salonId, memberId, ...target } }),
        ),
      ).rejects.toThrow(SlotConflictError)
    })

    it('should not swallow unrelated errors', async () => {
      // Une contrainte de clé étrangère ne doit pas être maquillée en conflit
      // de créneau : le message induirait le développeur en erreur.
      await expect(
        withSlotConflictMapping(() =>
          testDb.appointment.create({
            data: {
              salonId: 'salon-inexistant',
              memberId: 'membre-inexistant',
              ...slot('2026-09-01T12:00:00Z'),
            },
          }),
        ),
      ).rejects.not.toThrow(SlotConflictError)
    })
  })
})
