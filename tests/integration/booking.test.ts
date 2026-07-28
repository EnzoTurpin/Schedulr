import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { clearCache } from '@/features/availability/cache'
import { cancelBooking } from '@/features/booking/cancel'
import { createBooking } from '@/features/booking/create'
import {
  AppointmentNotActiveError,
  CancellationTooLateError,
  SlotUnavailableError,
} from '@/features/booking/errors'
import { canClientCancel, listUpcomingAppointments } from '@/features/booking/queries'
import { SlotConflictError } from '@/lib/db/errors'
import { ForbiddenError, ResourceNotFoundError, type Actor } from '@/lib/authz/types'
import { resetDatabase, testDb } from './helpers/db'

/**
 * Parcours de réservation de bout en bout.
 *
 * Vérifie ce que les tests du moteur ne peuvent pas voir : la revérification
 * serveur du créneau, le figement des prix, la course entre deux réservations
 * et les règles d'annulation.
 */

const h = (hours: number) => hours * 60
const WEDNESDAY_DOW = 3
const SLOT = new Date('2026-07-15T14:00:00+02:00')
const NOW = new Date('2026-07-01T10:00:00+02:00')

async function fixture() {
  const salon = await testDb.salon.create({
    data: {
      slug: 'salon-resa',
      name: 'Salon Réservation',
      address: '1 rue des Tests',
      city: 'Lyon',
      postalCode: '69000',
      isActive: true,
      slotStepMin: 30,
      bookingLeadTimeMin: 0,
      cancellationDeadlineHours: 24,
      openingHours: {
        create: [{ dayOfWeek: WEDNESDAY_DOW, startMin: h(9), endMin: h(19) }],
      },
    },
  })

  const service = await testDb.service.create({
    data: { salonId: salon.id, name: 'Coupe femme', durationMin: 60, priceCents: 3500 },
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

  const user = await testDb.user.create({
    data: { email: 'client@example.fr', firstName: 'Camille', lastName: 'Bernard' },
  })

  const actor: Actor = { userId: user.id, role: 'CLIENT', memberships: [] }

  return { salon, service, member, user, actor }
}

const booking = (salonId: string, serviceIds: string[], overrides = {}) => ({
  salonId,
  serviceIds,
  memberId: null,
  startAt: SLOT,
  now: NOW,
  ...overrides,
})

describe('réservation', () => {
  beforeEach(async () => {
    await resetDatabase()
    clearCache()
  })

  afterAll(async () => {
    await testDb.$disconnect()
  })

  describe('création', () => {
    it('should create an appointment on an available slot', async () => {
      const { salon, service, actor } = await fixture()

      const result = await createBooking(actor, booking(salon.id, [service.id]))

      expect(result.startAt.toISOString()).toBe(SLOT.toISOString())
      expect(await testDb.appointment.count()).toBe(1)
    })

    it('should compute the end time server-side from the service duration', async () => {
      const { salon, service, actor } = await fixture()

      const result = await createBooking(actor, booking(salon.id, [service.id]))

      expect((result.endAt.getTime() - result.startAt.getTime()) / 60_000).toBe(60)
    })

    it('should snapshot the price at booking time', async () => {
      // Changer un tarif ne doit jamais réécrire l'historique ni le montant
      // annoncé au client.
      const { salon, service, actor } = await fixture()
      const result = await createBooking(actor, booking(salon.id, [service.id]))

      await testDb.service.update({
        where: { id: service.id },
        data: { priceCents: 9900, name: 'Coupe femme premium' },
      })

      const item = await testDb.appointmentItem.findFirstOrThrow({
        where: { appointmentId: result.appointmentId },
      })
      expect(item.priceCents).toBe(3500)
      expect(item.nameSnapshot).toBe('Coupe femme')
    })

    it('should apply the staff-specific price override', async () => {
      const { salon, service, member, actor } = await fixture()
      await testDb.staffService.update({
        where: { memberId_serviceId: { memberId: member.id, serviceId: service.id } },
        data: { priceCents: 4200 },
      })

      const result = await createBooking(actor, booking(salon.id, [service.id]))

      expect(result.totalPriceCents).toBe(4200)
    })

    it('should keep the order of the requested services', async () => {
      const { salon, service, member, actor } = await fixture()
      const second = await testDb.service.create({
        data: { salonId: salon.id, name: 'Brushing', durationMin: 30, priceCents: 2000 },
      })
      await testDb.staffService.create({
        data: { salonId: salon.id, memberId: member.id, serviceId: second.id },
      })

      const result = await createBooking(
        actor,
        booking(salon.id, [second.id, service.id]),
      )

      const items = await testDb.appointmentItem.findMany({
        where: { appointmentId: result.appointmentId },
        orderBy: { position: 'asc' },
      })
      expect(items.map((i) => i.nameSnapshot)).toEqual(['Brushing', 'Coupe femme'])
      expect(result.totalPriceCents).toBe(5500)
    })

    it('should reject a slot outside the opening hours', async () => {
      const { salon, service, actor } = await fixture()

      await expect(
        createBooking(
          actor,
          booking(salon.id, [service.id], {
            startAt: new Date('2026-07-15T22:00:00+02:00'),
          }),
        ),
      ).rejects.toThrow(SlotUnavailableError)
    })

    it('should reject a slot not aligned on the salon step', async () => {
      // Le pas est de 30 min : 14 h 07 n'est jamais proposé.
      const { salon, service, actor } = await fixture()

      await expect(
        createBooking(
          actor,
          booking(salon.id, [service.id], {
            startAt: new Date('2026-07-15T14:07:00+02:00'),
          }),
        ),
      ).rejects.toThrow(SlotUnavailableError)
    })

    it('should reject a slot already taken', async () => {
      const { salon, service, member, actor } = await fixture()
      await testDb.appointment.create({
        data: {
          salonId: salon.id,
          memberId: member.id,
          startAt: SLOT,
          endAt: new Date('2026-07-15T15:00:00+02:00'),
        },
      })

      await expect(createBooking(actor, booking(salon.id, [service.id]))).rejects.toThrow(
        SlotUnavailableError,
      )
    })

    it('should reject a service from another salon', async () => {
      const { salon, actor } = await fixture()
      const other = await testDb.salon.create({
        data: {
          slug: 'autre',
          name: 'Autre',
          address: 'x',
          city: 'Lyon',
          postalCode: '69000',
          isActive: true,
        },
      })
      const foreign = await testDb.service.create({
        data: { salonId: other.id, name: 'Coupe', durationMin: 60, priceCents: 3000 },
      })

      await expect(
        createBooking(actor, booking(salon.id, [foreign.id])),
      ).rejects.toThrow()
    })

    it('should let exactly one of two concurrent bookings succeed', async () => {
      // La revérification serveur ne suffit pas : les deux requêtes la passent
      // avant que l'une n'écrive. Seule la contrainte d'exclusion tranche
      // (ADR-0004).
      const { salon, service, actor } = await fixture()

      const results = await Promise.allSettled([
        createBooking(actor, booking(salon.id, [service.id])),
        createBooking(actor, booking(salon.id, [service.id])),
      ])

      const fulfilled = results.filter((r) => r.status === 'fulfilled')
      expect(fulfilled).toHaveLength(1)
      expect(await testDb.appointment.count()).toBe(1)

      const rejection = results.find((r) => r.status === 'rejected')
      // Selon l'ordonnancement, le perdant est arrêté soit par la
      // revérification, soit par la base.
      expect(
        (rejection as PromiseRejectedResult).reason instanceof SlotConflictError ||
          (rejection as PromiseRejectedResult).reason instanceof SlotUnavailableError,
      ).toBe(true)
    })

    it('should free the slot from availability once booked', async () => {
      const { salon, service, actor } = await fixture()

      await createBooking(actor, booking(salon.id, [service.id]))

      // Le cache a bien été invalidé : le créneau ne doit plus être proposé.
      await expect(createBooking(actor, booking(salon.id, [service.id]))).rejects.toThrow(
        SlotUnavailableError,
      )
    })
  })

  describe('annulation', () => {
    async function bookedFixture() {
      const base = await fixture()
      const result = await createBooking(
        base.actor,
        booking(base.salon.id, [base.service.id]),
      )
      return { ...base, appointmentId: result.appointmentId }
    }

    it('should cancel an appointment owned by the client', async () => {
      const { actor, appointmentId } = await bookedFixture()

      await cancelBooking(actor, { appointmentId, now: NOW })

      const appointment = await testDb.appointment.findUniqueOrThrow({
        where: { id: appointmentId },
      })
      expect(appointment.status).toBe('CANCELLED')
      expect(appointment.cancelledBy).toBe(actor.userId)
    })

    it('should free the slot again after cancellation', async () => {
      const { salon, service, actor, appointmentId } = await bookedFixture()

      await cancelBooking(actor, { appointmentId, now: NOW })

      // Rejouable : le créneau est de nouveau proposé.
      await expect(
        createBooking(actor, booking(salon.id, [service.id])),
      ).resolves.toBeDefined()
    })

    it('should record an audit entry without personal data', async () => {
      const { actor, appointmentId } = await bookedFixture()

      await cancelBooking(actor, { appointmentId, now: NOW })

      const log = await testDb.auditLog.findFirstOrThrow()
      expect(log.action).toBe('appointment.cancelled')
      expect(JSON.stringify(log.metadata)).not.toContain('@')
    })

    it('should refuse a cancellation past the deadline', async () => {
      const { actor, appointmentId } = await bookedFixture()
      // Deux heures avant le rendez-vous, alors que le délai est de 24 h.
      const tooLate = new Date('2026-07-15T12:00:00+02:00')

      await expect(cancelBooking(actor, { appointmentId, now: tooLate })).rejects.toThrow(
        CancellationTooLateError,
      )
    })

    it('should accept a cancellation exactly at the deadline', async () => {
      const { actor, appointmentId } = await bookedFixture()
      const atDeadline = new Date('2026-07-14T14:00:00+02:00')

      await expect(
        cancelBooking(actor, { appointmentId, now: atDeadline }),
      ).resolves.toBeUndefined()
    })

    it('should let salon staff cancel past the deadline', async () => {
      // Le délai protège l'agenda du salon ; il ne s'applique pas au salon.
      const { salon, member, appointmentId } = await bookedFixture()
      // Le compte doit exister : `AuditLog.actorId` porte une clé étrangère.
      const managerUser = await testDb.user.create({
        data: { email: 'gerant@example.fr', firstName: 'Julie', lastName: 'Roux' },
      })
      const manager: Actor = {
        userId: managerUser.id,
        role: 'CLIENT',
        memberships: [
          { salonId: salon.id, memberId: member.id, role: 'MANAGER', isActive: true },
        ],
      }

      await expect(
        cancelBooking(manager, {
          appointmentId,
          now: new Date('2026-07-15T13:00:00+02:00'),
        }),
      ).resolves.toBeUndefined()
    })

    it('should hide someone else’s appointment behind a not-found error', async () => {
      // Pas `ForbiddenError` : un 403 confirmerait l'existence du rendez-vous à
      // un tiers, et donc qu'une personne a rendez-vous dans ce salon
      // (ADR-0002).
      const { appointmentId } = await bookedFixture()
      const stranger: Actor = { userId: 'autre', role: 'CLIENT', memberships: [] }

      await expect(cancelBooking(stranger, { appointmentId, now: NOW })).rejects.toThrow(
        ResourceNotFoundError,
      )
    })

    it('should refuse a staff member of the salon who lacks the right role', async () => {
      // Ici l'appelant a bien accès au salon : révéler l'existence est sans
      // conséquence, on renvoie donc un refus explicite.
      const { salon, member, appointmentId } = await bookedFixture()
      const staffUser = await testDb.user.create({
        data: { email: 'coiffeur@example.fr', firstName: 'Sofia', lastName: 'Nguyen' },
      })
      const staff: Actor = {
        userId: staffUser.id,
        role: 'CLIENT',
        memberships: [
          { salonId: salon.id, memberId: member.id, role: 'STAFF', isActive: true },
        ],
      }

      await expect(cancelBooking(staff, { appointmentId, now: NOW })).rejects.toThrow(
        ForbiddenError,
      )
    })

    it('should report an unknown appointment as not found', async () => {
      const { actor } = await fixture()

      await expect(
        cancelBooking(actor, { appointmentId: 'inexistant', now: NOW }),
      ).rejects.toThrow(ResourceNotFoundError)
    })

    it('should refuse cancelling twice', async () => {
      const { actor, appointmentId } = await bookedFixture()
      await cancelBooking(actor, { appointmentId, now: NOW })

      await expect(cancelBooking(actor, { appointmentId, now: NOW })).rejects.toThrow(
        AppointmentNotActiveError,
      )
    })
  })

  describe('espace client', () => {
    it('should list upcoming appointments only', async () => {
      const { salon, service, member, actor } = await fixture()
      await createBooking(actor, booking(salon.id, [service.id]))
      // Rendez-vous passé, qui ne doit pas apparaître.
      await testDb.appointment.create({
        data: {
          salonId: salon.id,
          memberId: member.id,
          clientId: actor.userId,
          startAt: new Date('2026-06-01T14:00:00+02:00'),
          endAt: new Date('2026-06-01T15:00:00+02:00'),
        },
      })

      const upcoming = await listUpcomingAppointments(actor, NOW)

      expect(upcoming).toHaveLength(1)
      expect(upcoming[0]?.salon.name).toBe('Salon Réservation')
      expect(upcoming[0]?.items[0]?.nameSnapshot).toBe('Coupe femme')
    })

    it('should not list appointments of another client', async () => {
      const { salon, service, actor } = await fixture()
      await createBooking(actor, booking(salon.id, [service.id]))
      const stranger: Actor = { userId: 'autre', role: 'CLIENT', memberships: [] }

      expect(await listUpcomingAppointments(stranger, NOW)).toEqual([])
    })

    it('should hide a cancelled appointment from the upcoming list', async () => {
      const { salon, service, actor } = await fixture()
      const result = await createBooking(actor, booking(salon.id, [service.id]))
      await cancelBooking(actor, { appointmentId: result.appointmentId, now: NOW })

      expect(await listUpcomingAppointments(actor, NOW)).toEqual([])
    })

    it('should expose whether the client can still cancel', async () => {
      const { salon, service, actor } = await fixture()
      await createBooking(actor, booking(salon.id, [service.id]))
      const [appointment] = await listUpcomingAppointments(actor, NOW)

      expect(canClientCancel(appointment!, NOW)).toBe(true)
      expect(canClientCancel(appointment!, new Date('2026-07-15T12:00:00+02:00'))).toBe(
        false,
      )
    })
  })
})
