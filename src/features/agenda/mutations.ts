import { invalidateSalon } from '@/features/availability'
import { assertCan } from '@/lib/authz/can'
import { ResourceNotFoundError, type Actor } from '@/lib/authz/types'
import { prisma } from '@/lib/db/client'
import { withSlotConflictMapping } from '@/lib/db/errors'
import { forSalon } from '@/lib/db/scoped'
import type { AppointmentStatus } from '@/generated/prisma'

/**
 * Écritures de l'agenda professionnel.
 *
 * Le salon n'est pas soumis aux mêmes règles que le client : il peut créer un
 * rendez-vous hors des créneaux proposés — un client qui pousse la porte à
 * 18 h 55 ne doit pas être refusé par le logiciel. En revanche la contrainte
 * d'exclusion s'applique à lui aussi : deux rendez-vous ne peuvent pas se
 * chevaucher pour un même coiffeur, quel que soit le chemin d'écriture
 * (ADR-0004).
 */

export type CreateWalkInInput = {
  salonId: string
  memberId: string
  serviceIds: string[]
  startAt: Date
  /** Client sans compte : identité saisie au comptoir. */
  guestName: string
  guestPhone?: string
  source: 'SALON' | 'PHONE'
  staffNote?: string
}

/**
 * Crée un rendez-vous pris au comptoir ou par téléphone.
 *
 * @throws {SlotConflictError} le coiffeur a déjà un rendez-vous sur la plage.
 */
export async function createWalkIn(actor: Actor, input: CreateWalkInInput) {
  assertCan(actor, 'appointment:write_any', {
    kind: 'salon',
    salonId: input.salonId,
  })

  const db = forSalon(input.salonId)

  const services = await db.service.findMany({
    where: { id: { in: input.serviceIds }, isActive: true },
    select: {
      id: true,
      name: true,
      durationMin: true,
      priceCents: true,
      bufferBeforeMin: true,
      bufferAfterMin: true,
    },
  })

  if (services.length === 0 || services.length !== new Set(input.serviceIds).size) {
    throw new ResourceNotFoundError()
  }

  // Durée relue en base, jamais reçue du formulaire.
  const totalMin = services.reduce(
    (sum, s) => sum + s.durationMin + s.bufferBeforeMin + s.bufferAfterMin,
    0,
  )
  const endAt = new Date(input.startAt.getTime() + totalMin * 60_000)

  const appointment = await withSlotConflictMapping(() =>
    db.appointment.create({
      data: {
        salonId: input.salonId,
        memberId: input.memberId,
        clientId: null,
        guestName: input.guestName,
        guestPhone: input.guestPhone ?? null,
        startAt: input.startAt,
        endAt,
        source: input.source,
        staffNote: input.staffNote ?? null,
        items: {
          create: input.serviceIds.map((serviceId, position) => {
            const service = services.find((s) => s.id === serviceId)!
            return {
              salonId: input.salonId,
              serviceId,
              nameSnapshot: service.name,
              durationMin: service.durationMin,
              priceCents: service.priceCents,
              position,
            }
          }),
        },
      },
      select: { id: true, startAt: true, endAt: true },
    }),
  )

  invalidateSalon(input.salonId)
  return appointment
}

export type MoveAppointmentInput = {
  salonId: string
  appointmentId: string
  /** Nouveau début. La durée est conservée. */
  startAt: Date
  /** Nouveau coiffeur, ou `undefined` pour conserver l'actuel. */
  memberId?: string
}

/**
 * Déplace un rendez-vous par glisser-déposer.
 *
 * La durée est conservée : déplacer n'est pas redimensionner. La contrainte
 * d'exclusion peut refuser l'opération — l'interface doit alors remettre le
 * bloc à sa position d'origine (ADR-0004).
 */
export async function moveAppointment(actor: Actor, input: MoveAppointmentInput) {
  const db = forSalon(input.salonId)

  const existing = await db.appointment.findUnique({
    where: { id: input.appointmentId },
    select: { id: true, memberId: true, startAt: true, endAt: true, status: true },
  })

  if (!existing) {
    throw new ResourceNotFoundError()
  }

  assertCan(actor, 'appointment:write_any', {
    kind: 'appointment',
    salonId: input.salonId,
    memberId: existing.memberId,
    clientId: null,
  })

  const duration = existing.endAt.getTime() - existing.startAt.getTime()

  const updated = await withSlotConflictMapping(() =>
    db.appointment.update({
      where: { id: input.appointmentId },
      data: {
        startAt: input.startAt,
        endAt: new Date(input.startAt.getTime() + duration),
        ...(input.memberId ? { memberId: input.memberId } : {}),
      },
      select: { id: true, startAt: true, endAt: true, memberId: true },
    }),
  )

  invalidateSalon(input.salonId)
  return updated
}

export type ResizeAppointmentInput = {
  salonId: string
  appointmentId: string
  /** Nouvelle fin. Le début est conservé. */
  endAt: Date
}

/** Redimensionne un rendez-vous : la prestation a duré plus ou moins longtemps. */
export async function resizeAppointment(actor: Actor, input: ResizeAppointmentInput) {
  const db = forSalon(input.salonId)

  const existing = await db.appointment.findUnique({
    where: { id: input.appointmentId },
    select: { memberId: true, startAt: true },
  })

  if (!existing) {
    throw new ResourceNotFoundError()
  }

  assertCan(actor, 'appointment:write_any', {
    kind: 'appointment',
    salonId: input.salonId,
    memberId: existing.memberId,
    clientId: null,
  })

  // La contrainte `Appointment_end_after_start` refuserait la ligne, mais
  // autant produire une erreur métier lisible.
  if (input.endAt.getTime() <= existing.startAt.getTime()) {
    throw new Error('La fin d’un rendez-vous doit suivre son début.')
  }

  const updated = await withSlotConflictMapping(() =>
    db.appointment.update({
      where: { id: input.appointmentId },
      data: { endAt: input.endAt },
      select: { id: true, startAt: true, endAt: true },
    }),
  )

  invalidateSalon(input.salonId)
  return updated
}

/** Statuts qu'un membre du salon peut poser depuis l'agenda. */
const SETTABLE_STATUSES: AppointmentStatus[] = [
  'CONFIRMED',
  'DONE',
  'NO_SHOW',
  'CANCELLED',
]

export type SetStatusInput = {
  salonId: string
  appointmentId: string
  status: AppointmentStatus
}

/**
 * Change le statut d'un rendez-vous : prestation réalisée, client absent,
 * annulation par le salon.
 *
 * Un coiffeur ne pilote que ses propres rendez-vous ; un manager pilote ceux de
 * toute l'équipe. C'est `assertCan` qui applique la distinction.
 */
export async function setAppointmentStatus(actor: Actor, input: SetStatusInput) {
  if (!SETTABLE_STATUSES.includes(input.status)) {
    throw new Error(`Statut « ${input.status} » non modifiable depuis l’agenda.`)
  }

  const db = forSalon(input.salonId)

  const existing = await db.appointment.findUnique({
    where: { id: input.appointmentId },
    select: { memberId: true, clientId: true, status: true },
  })

  if (!existing) {
    throw new ResourceNotFoundError()
  }

  assertCan(actor, 'appointment:set_status', {
    kind: 'appointment',
    salonId: input.salonId,
    memberId: existing.memberId,
    clientId: existing.clientId,
  })

  const updated = await db.appointment.update({
    where: { id: input.appointmentId },
    data: {
      status: input.status,
      ...(input.status === 'CANCELLED'
        ? { cancelledAt: new Date(), cancelledBy: actor.userId }
        : {}),
    },
    select: { id: true, status: true },
  })

  await prisma.auditLog.create({
    data: {
      salonId: input.salonId,
      actorId: actor.userId,
      action: `appointment.status.${input.status.toLowerCase()}`,
      targetType: 'Appointment',
      targetId: input.appointmentId,
      metadata: { from: existing.status, to: input.status },
    },
  })

  // Annuler ou marquer absent libère le créneau : les disponibilités changent.
  invalidateSalon(input.salonId)
  return updated
}

/** Note interne du salon, jamais visible du client. */
export async function setStaffNote(
  actor: Actor,
  input: { salonId: string; appointmentId: string; staffNote: string },
) {
  const db = forSalon(input.salonId)

  const existing = await db.appointment.findUnique({
    where: { id: input.appointmentId },
    select: { memberId: true, clientId: true },
  })

  if (!existing) {
    throw new ResourceNotFoundError()
  }

  assertCan(actor, 'appointment:set_status', {
    kind: 'appointment',
    salonId: input.salonId,
    memberId: existing.memberId,
    clientId: existing.clientId,
  })

  return db.appointment.update({
    where: { id: input.appointmentId },
    data: { staffNote: input.staffNote.slice(0, 1000) },
    select: { id: true },
  })
}
