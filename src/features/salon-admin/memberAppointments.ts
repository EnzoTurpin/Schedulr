import { invalidateSalon } from '@/features/availability'
import { notify } from '@/features/notifications/dispatch'
import { assertCan } from '@/lib/authz/can'
import { ResourceNotFoundError, type Actor } from '@/lib/authz/types'
import { forSalon } from '@/lib/db/scoped'

/**
 * Rendez-vous à venir d'un membre qu'on s'apprête à désactiver.
 *
 * Désactiver un membre les faisait disparaître de l'agenda — `listAgendaStaff`
 * ne renvoie que les membres actifs — tout en les laissant confirmés côté
 * client : la personne se présentait, le salon n'en avait aucune trace. Ce
 * module donne au salon les deux issues possibles, transfert ou annulation, et
 * prévient chaque client dans les deux cas.
 */

export class PendingAppointmentsError extends Error {
  constructor(readonly count: number) {
    super(
      `Ce membre a encore ${count} rendez-vous à venir. Transférez-les ou ` +
        `annulez-les avant de le désactiver.`,
    )
    this.name = 'PendingAppointmentsError'
  }
}

/** Rendez-vous à venir d'un membre, qui bloquent sa désactivation. */
export async function countUpcomingAppointments(
  actor: Actor,
  salonId: string,
  memberId: string,
  now = new Date(),
): Promise<number> {
  assertCan(actor, 'agenda:read_salon', { kind: 'salon', salonId })

  return forSalon(salonId).appointment.count({
    where: {
      memberId,
      status: { in: ['PENDING', 'CONFIRMED'] },
      startAt: { gt: now },
    },
  })
}

/**
 * Transfère les rendez-vous à venir d'un membre vers un autre.
 *
 * Un par un, et non en masse : la contrainte anti-chevauchement peut refuser
 * un créneau déjà occupé chez la personne cible. Un échec partiel signalé vaut
 * mieux qu'un blocage total — le salon traite le reliquat à la main.
 *
 * @returns les identifiants des rendez-vous qui n'ont pu être transférés.
 */
export async function transferUpcomingAppointments(
  actor: Actor,
  salonId: string,
  fromMemberId: string,
  toMemberId: string,
  now = new Date(),
): Promise<{ moved: number; failed: string[] }> {
  assertCan(actor, 'appointment:write_any', {
    kind: 'appointment',
    salonId,
    memberId: fromMemberId,
    clientId: null,
  })

  const db = forSalon(salonId)

  const target = await db.salonMember.findUnique({
    where: { id: toMemberId },
    select: { id: true, isActive: true },
  })
  if (!target || !target.isActive) throw new ResourceNotFoundError()

  const pending = await db.appointment.findMany({
    where: {
      memberId: fromMemberId,
      status: { in: ['PENDING', 'CONFIRMED'] },
      startAt: { gt: now },
    },
    orderBy: { startAt: 'asc' },
    select: { id: true },
  })

  const failed: string[] = []
  let moved = 0

  for (const appointment of pending) {
    try {
      await db.appointment.update({
        where: { id: appointment.id },
        data: { memberId: toMemberId },
      })
      // Le client change d'interlocuteur : il doit l'apprendre.
      await notify('booking_updated', appointment.id).catch(() => {})
      moved += 1
    } catch {
      // Créneau déjà occupé chez la personne cible.
      failed.push(appointment.id)
    }
  }

  invalidateSalon(salonId)
  return { moved, failed }
}

/** Annule les rendez-vous à venir d'un membre, chaque client prévenu. */
export async function cancelUpcomingAppointments(
  actor: Actor,
  salonId: string,
  memberId: string,
  now = new Date(),
): Promise<number> {
  assertCan(actor, 'appointment:write_any', {
    kind: 'appointment',
    salonId,
    memberId,
    clientId: null,
  })

  const db = forSalon(salonId)

  const pending = await db.appointment.findMany({
    where: {
      memberId,
      status: { in: ['PENDING', 'CONFIRMED'] },
      startAt: { gt: now },
    },
    select: { id: true },
  })

  for (const appointment of pending) {
    await db.appointment.update({
      where: { id: appointment.id },
      data: { status: 'CANCELLED', cancelledAt: now, cancelledBy: actor.userId },
    })
    await notify('booking_cancelled', appointment.id).catch(() => {})
  }

  invalidateSalon(salonId)
  return pending.length
}
