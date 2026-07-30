import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { clearCache } from '@/features/availability/cache'
import { listAgenda, listAgendaStaff } from '@/features/agenda/queries'
import {
  cancelUpcomingAppointments,
  countUpcomingAppointments,
  PendingAppointmentsError,
  transferUpcomingAppointments,
} from '@/features/salon-admin/memberAppointments'
import { deactivateMember } from '@/features/salon-admin/team'
import { type Actor } from '@/lib/authz/types'
import { resetDatabase, testDb } from './helpers/db'

/**
 * Désactivation d'un membre porteur de rendez-vous.
 *
 * Le défaut d'origine : la désactivation passait, `listAgendaStaff` ne renvoyant
 * que les membres actifs faisait disparaître les rendez-vous de l'agenda, et
 * ceux-ci restaient confirmés côté client. Le client se présentait, le salon
 * n'en avait aucune trace.
 */

const h = (hours: number) => hours * 60

/** Instant à J+`days`, à `hour` heure locale de Paris. */
function futureAt(days: number, hour: number): Date {
  const date = new Date()
  date.setDate(date.getDate() + days)
  date.setHours(hour, 0, 0, 0)
  return date
}

async function fixture() {
  const salon = await testDb.salon.create({
    data: {
      slug: 'salon-desactivation',
      name: 'Salon Désactivation',
      address: '1 rue des Tests',
      city: 'Lyon',
      postalCode: '69000',
      isActive: true,
      openingHours: {
        create: Array.from({ length: 7 }, (_, dayOfWeek) => ({
          dayOfWeek,
          startMin: h(9),
          endMin: h(19),
        })),
      },
    },
  })

  const service = await testDb.service.create({
    data: { salonId: salon.id, name: 'Coupe', durationMin: 60, priceCents: 3000 },
  })

  const ownerUser = await testDb.user.create({
    data: { email: 'gerante-desac@example.fr', firstName: 'Julie' },
  })

  const owner = await testDb.salonMember.create({
    data: {
      salonId: salon.id,
      userId: ownerUser.id,
      role: 'OWNER',
      displayName: 'Julie',
    },
  })

  const leaving = await testDb.salonMember.create({
    data: { salonId: salon.id, role: 'STAFF', displayName: 'Partant', isBookable: true },
  })

  const staying = await testDb.salonMember.create({
    data: { salonId: salon.id, role: 'STAFF', displayName: 'Restant', isBookable: true },
  })

  const client = await testDb.user.create({
    data: { email: 'cliente-desac@example.fr', firstName: 'Camille' },
  })

  const actor: Actor = {
    userId: ownerUser.id,
    role: 'CLIENT',
    memberships: [
      { salonId: salon.id, memberId: owner.id, role: 'OWNER', isActive: true },
    ],
  }

  return { salon, service, actor, leaving, staying, client }
}

/** Pose un rendez-vous à venir pour un membre. */
async function seedUpcoming(
  ctx: Awaited<ReturnType<typeof fixture>>,
  memberId: string,
  days: number,
  hour: number,
) {
  const startAt = futureAt(days, hour)
  return testDb.appointment.create({
    data: {
      salonId: ctx.salon.id,
      memberId,
      clientId: ctx.client.id,
      startAt,
      endAt: new Date(startAt.getTime() + 60 * 60_000),
      items: {
        create: {
          salonId: ctx.salon.id,
          serviceId: ctx.service.id,
          nameSnapshot: 'Coupe',
          durationMin: 60,
          priceCents: 3000,
        },
      },
    },
  })
}

describe('désactivation d’un membre', () => {
  beforeEach(async () => {
    await resetDatabase()
    clearCache()
  })

  afterAll(async () => {
    await testDb.$disconnect()
  })

  it('should refuse the deactivation when upcoming appointments remain', async () => {
    const ctx = await fixture()
    await seedUpcoming(ctx, ctx.leaving.id, 3, 10)

    await expect(
      deactivateMember(ctx.actor, ctx.salon.id, ctx.leaving.id),
    ).rejects.toThrow(PendingAppointmentsError)

    const member = await testDb.salonMember.findUniqueOrThrow({
      where: { id: ctx.leaving.id },
    })
    expect(member.isActive).toBe(true)
  })

  it('should state how many appointments block the deactivation', async () => {
    const ctx = await fixture()
    await seedUpcoming(ctx, ctx.leaving.id, 3, 10)
    await seedUpcoming(ctx, ctx.leaving.id, 4, 10)

    await expect(
      deactivateMember(ctx.actor, ctx.salon.id, ctx.leaving.id),
    ).rejects.toThrow(/2 rendez-vous/)
  })

  it('should allow the deactivation when only past appointments remain', async () => {
    // Un rendez-vous passé ne pose aucun problème : il est historique.
    const ctx = await fixture()
    const past = futureAt(-5, 10)
    await testDb.appointment.create({
      data: {
        salonId: ctx.salon.id,
        memberId: ctx.leaving.id,
        startAt: past,
        endAt: new Date(past.getTime() + 60 * 60_000),
        status: 'DONE',
      },
    })

    await deactivateMember(ctx.actor, ctx.salon.id, ctx.leaving.id)

    const member = await testDb.salonMember.findUniqueOrThrow({
      where: { id: ctx.leaving.id },
    })
    expect(member.isActive).toBe(false)
  })

  it('should never leave a confirmed appointment invisible in the agenda', async () => {
    // Le contrôle qui manquait : c'est exactement le défaut d'origine.
    const ctx = await fixture()
    await seedUpcoming(ctx, ctx.leaving.id, 3, 10)

    await expect(
      deactivateMember(ctx.actor, ctx.salon.id, ctx.leaving.id),
    ).rejects.toThrow()

    const from = new Date()
    const to = futureAt(30, 23)
    const appointments = await listAgenda(ctx.salon.id, from, to)
    const shown = (await listAgendaStaff(ctx.salon.id)).map((member) => member.id)
    const invisible = appointments.filter(
      (appointment) => !shown.includes(appointment.memberId),
    )

    expect(invisible).toEqual([])
  })

  describe('transfert', () => {
    it('should move upcoming appointments to another member', async () => {
      const ctx = await fixture()
      await seedUpcoming(ctx, ctx.leaving.id, 3, 10)
      await seedUpcoming(ctx, ctx.leaving.id, 4, 10)

      const result = await transferUpcomingAppointments(
        ctx.actor,
        ctx.salon.id,
        ctx.leaving.id,
        ctx.staying.id,
      )

      expect(result).toEqual({ moved: 2, failed: [] })
      expect(
        await countUpcomingAppointments(ctx.actor, ctx.salon.id, ctx.leaving.id),
      ).toBe(0)
      expect(
        await countUpcomingAppointments(ctx.actor, ctx.salon.id, ctx.staying.id),
      ).toBe(2)
    })

    it('should report the appointments whose slot is already taken', async () => {
      // La contrainte anti-chevauchement refuse ce créneau chez la cible : un
      // échec partiel signalé vaut mieux qu'un blocage total.
      const ctx = await fixture()
      await seedUpcoming(ctx, ctx.leaving.id, 3, 10)
      await seedUpcoming(ctx, ctx.leaving.id, 4, 10)
      await seedUpcoming(ctx, ctx.staying.id, 3, 10)

      const result = await transferUpcomingAppointments(
        ctx.actor,
        ctx.salon.id,
        ctx.leaving.id,
        ctx.staying.id,
      )

      expect(result.moved).toBe(1)
      expect(result.failed).toHaveLength(1)
      // Le rendez-vous en conflit reste chez la personne qui part.
      expect(
        await countUpcomingAppointments(ctx.actor, ctx.salon.id, ctx.leaving.id),
      ).toBe(1)
    })

    it('should leave past appointments with the departing member', async () => {
      // L'historique appartient à qui a réalisé la prestation.
      const ctx = await fixture()
      const past = futureAt(-5, 10)
      await testDb.appointment.create({
        data: {
          salonId: ctx.salon.id,
          memberId: ctx.leaving.id,
          startAt: past,
          endAt: new Date(past.getTime() + 60 * 60_000),
          status: 'DONE',
        },
      })

      await transferUpcomingAppointments(
        ctx.actor,
        ctx.salon.id,
        ctx.leaving.id,
        ctx.staying.id,
      )

      const kept = await testDb.appointment.count({
        where: { memberId: ctx.leaving.id, status: 'DONE' },
      })
      expect(kept).toBe(1)
    })

    it('should refuse an inactive target', async () => {
      const ctx = await fixture()
      await testDb.salonMember.update({
        where: { id: ctx.staying.id },
        data: { isActive: false },
      })

      await expect(
        transferUpcomingAppointments(
          ctx.actor,
          ctx.salon.id,
          ctx.leaving.id,
          ctx.staying.id,
        ),
      ).rejects.toThrow()
    })
  })

  describe('annulation', () => {
    it('should cancel every upcoming appointment', async () => {
      const ctx = await fixture()
      await seedUpcoming(ctx, ctx.leaving.id, 3, 10)
      await seedUpcoming(ctx, ctx.leaving.id, 4, 10)

      expect(
        await cancelUpcomingAppointments(ctx.actor, ctx.salon.id, ctx.leaving.id),
      ).toBe(2)

      const cancelled = await testDb.appointment.findMany({
        where: { memberId: ctx.leaving.id },
      })
      expect(cancelled.every((row) => row.status === 'CANCELLED')).toBe(true)
      expect(cancelled.every((row) => row.cancelledAt !== null)).toBe(true)
    })

    it('should record who cancelled', async () => {
      // La trace doit survivre à l'anonymisation du compte : `cancelledBy` est
      // un identifiant sans relation.
      const ctx = await fixture()
      await seedUpcoming(ctx, ctx.leaving.id, 3, 10)

      await cancelUpcomingAppointments(ctx.actor, ctx.salon.id, ctx.leaving.id)

      const row = await testDb.appointment.findFirstOrThrow({
        where: { memberId: ctx.leaving.id },
      })
      expect(row.cancelledBy).toBe(ctx.actor.userId)
    })

    it('should unblock the deactivation once cancelled', async () => {
      const ctx = await fixture()
      await seedUpcoming(ctx, ctx.leaving.id, 3, 10)

      await cancelUpcomingAppointments(ctx.actor, ctx.salon.id, ctx.leaving.id)
      await deactivateMember(ctx.actor, ctx.salon.id, ctx.leaving.id)

      const member = await testDb.salonMember.findUniqueOrThrow({
        where: { id: ctx.leaving.id },
      })
      expect(member.isActive).toBe(false)
    })
  })
})
