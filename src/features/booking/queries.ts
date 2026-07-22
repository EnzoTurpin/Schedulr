import type { AppointmentStatus } from '@/generated/prisma'
import { prisma } from '@/lib/db/client'
import type { Actor } from '@/lib/authz/types'

/**
 * Lectures de l'espace client.
 *
 * Le cloisonnement par salon ne s'applique pas ici : un client peut réserver
 * dans plusieurs salons, et ses rendez-vous lui appartiennent, pas au tenant.
 * Le filtre de sécurité est donc `clientId = actor.userId`, appliqué
 * systématiquement.
 */

/** Statuts qui n'occupent plus de créneau : ils relèvent de l'historique. */
const INACTIVE_STATUSES: AppointmentStatus[] = ['CANCELLED', 'NO_SHOW']

/** Statuts d'un rendez-vous encore honorable. */
const ACTIVE_STATUSES: AppointmentStatus[] = ['PENDING', 'CONFIRMED']

const APPOINTMENT_FIELDS = {
  id: true,
  startAt: true,
  endAt: true,
  status: true,
  clientNote: true,
  salon: {
    select: {
      id: true,
      slug: true,
      name: true,
      city: true,
      address: true,
      timezone: true,
      cancellationDeadlineHours: true,
    },
  },
  member: { select: { displayName: true } },
  items: {
    orderBy: { position: 'asc' },
    select: { nameSnapshot: true, priceCents: true, durationMin: true },
  },
} as const

export type ClientAppointment = Awaited<
  ReturnType<typeof listUpcomingAppointments>
>[number]

/** Rendez-vous à venir, du plus proche au plus lointain. */
export async function listUpcomingAppointments(actor: Actor, now = new Date()) {
  return prisma.appointment.findMany({
    where: {
      clientId: actor.userId,
      startAt: { gte: now },
      status: { in: ACTIVE_STATUSES },
    },
    orderBy: { startAt: 'asc' },
    select: APPOINTMENT_FIELDS,
  })
}

/**
 * Historique : rendez-vous passés, annulés ou manqués.
 *
 * Pagination obligatoire — le CLAUDE.md l'impose au-delà de 50 éléments, et un
 * client fidèle en accumule bien plus.
 */
export async function listPastAppointments(
  actor: Actor,
  { now = new Date(), take = 20, skip = 0 } = {},
) {
  const where = {
    clientId: actor.userId,
    OR: [{ startAt: { lt: now } }, { status: { in: INACTIVE_STATUSES } }],
  }

  const [items, total] = await Promise.all([
    prisma.appointment.findMany({
      where,
      orderBy: { startAt: 'desc' },
      take,
      skip,
      select: APPOINTMENT_FIELDS,
    }),
    prisma.appointment.count({ where }),
  ])

  return { items, total, hasMore: skip + items.length < total }
}

/**
 * Indique si le client peut encore annuler lui-même.
 *
 * Dupliquée côté lecture pour n'afficher le bouton que lorsqu'il est utilisable
 * — la règle qui fait autorité reste celle appliquée par `cancelBooking`.
 */
export function canClientCancel(
  appointment: {
    startAt: Date
    status: string
    salon: { cancellationDeadlineHours: number }
  },
  now = new Date(),
): boolean {
  if (appointment.status !== 'CONFIRMED' && appointment.status !== 'PENDING') {
    return false
  }
  const deadline =
    appointment.startAt.getTime() -
    appointment.salon.cancellationDeadlineHours * 3_600_000
  return now.getTime() <= deadline
}
