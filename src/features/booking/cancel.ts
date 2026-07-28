import { invalidateSalon } from '@/features/availability'
import { notify } from '@/features/notifications/dispatch'
import { assertCan } from '@/lib/authz/can'
import { ResourceNotFoundError, type Actor } from '@/lib/authz/types'
import { forSalon } from '@/lib/db/scoped'
import { prisma } from '@/lib/db/client'
import { AppointmentNotActiveError, CancellationTooLateError } from './errors'

/**
 * Annulation d'un rendez-vous.
 *
 * L'annulation libère le créneau : la contrainte d'exclusion ne retient que les
 * statuts actifs (ADR-0004). Il faut donc invalider le cache de disponibilité,
 * sans quoi le créneau redevenu libre resterait masqué.
 */

export type CancelBookingInput = {
  appointmentId: string
  /** Injecté pour rendre les tests déterministes. */
  now?: Date
}

/**
 * @throws {ResourceNotFoundError} rendez-vous inexistant ou hors périmètre.
 * @throws {AppointmentNotActiveError} déjà annulé, honoré ou marqué absent.
 * @throws {CancellationTooLateError} délai d'annulation dépassé.
 */
export async function cancelBooking(
  actor: Actor,
  input: CancelBookingInput,
): Promise<void> {
  const now = input.now ?? new Date()

  // Lecture non cloisonnée assumée : on ne connaît pas encore le salon du
  // rendez-vous. L'autorisation est contrôlée juste après, et un rendez-vous
  // hors périmètre est signalé « introuvable ».
  const appointment = await prisma.appointment.findUnique({
    where: { id: input.appointmentId },
    select: {
      id: true,
      salonId: true,
      memberId: true,
      clientId: true,
      startAt: true,
      status: true,
      salon: { select: { cancellationDeadlineHours: true } },
    },
  })

  if (!appointment) {
    throw new ResourceNotFoundError()
  }

  const resource = {
    kind: 'appointment' as const,
    salonId: appointment.salonId,
    memberId: appointment.memberId,
    clientId: appointment.clientId,
  }

  const isOwnAppointment = appointment.clientId === actor.userId

  // Le client annule le sien ; le personnel du salon annule celui de n'importe
  // quel client. `assertCan` distingue 404 et 403 (ADR-0002).
  assertCan(
    actor,
    isOwnAppointment ? 'appointment:cancel_own' : 'appointment:write_any',
    resource,
  )

  if (appointment.status !== 'CONFIRMED' && appointment.status !== 'PENDING') {
    throw new AppointmentNotActiveError()
  }

  // Le délai ne s'applique qu'au client : le salon doit pouvoir annuler à tout
  // moment, y compris le jour même.
  if (isOwnAppointment) {
    const deadlineHours = appointment.salon.cancellationDeadlineHours
    const deadline = appointment.startAt.getTime() - deadlineHours * 60 * 60 * 1000

    if (now.getTime() > deadline) {
      throw new CancellationTooLateError(deadlineHours)
    }
  }

  const db = forSalon(appointment.salonId)

  await db.appointment.update({
    where: { id: appointment.id },
    data: {
      status: 'CANCELLED',
      cancelledAt: now,
      cancelledBy: actor.userId,
    },
  })

  await prisma.auditLog.create({
    data: {
      salonId: appointment.salonId,
      actorId: actor.userId,
      action: 'appointment.cancelled',
      targetType: 'Appointment',
      targetId: appointment.id,
      // Aucune donnée personnelle : le journal doit survivre à l'anonymisation
      // du compte sans la contredire.
      metadata: { byClient: isOwnAppointment },
    },
  })

  invalidateSalon(appointment.salonId)

  // Prévenir le client est utile surtout quand c'est le salon qui annule ; on
  // notifie dans les deux cas, la trace servant d'accusé de réception.
  await notify('booking_cancelled', appointment.id).catch((error: unknown) => {
    console.error('booking_cancelled', { appointmentId: appointment.id, error })
  })
}
