/**
 * Erreurs métier de la réservation.
 *
 * Chacune correspond à un message précis côté interface. Elles sont distinctes
 * pour que l'appelant puisse réagir : rafraîchir les créneaux sur un conflit,
 * proposer un autre coiffeur sur une indisponibilité, expliquer un délai.
 */

/** Le créneau demandé n'est pas (ou plus) proposé par le moteur. */
export class SlotUnavailableError extends Error {
  constructor() {
    super('Ce créneau n’est plus disponible.')
    this.name = 'SlotUnavailableError'
  }
}

/** Le rendez-vous est trop proche pour être annulé par le client. */
export class CancellationTooLateError extends Error {
  constructor(public readonly deadlineHours: number) {
    super(
      `Ce rendez-vous ne peut plus être annulé en ligne : le délai de ` +
        `${deadlineHours} h est dépassé. Contactez le salon.`,
    )
    this.name = 'CancellationTooLateError'
  }
}

/** Le rendez-vous n'est plus dans un état permettant l'action demandée. */
export class AppointmentNotActiveError extends Error {
  constructor() {
    super('Ce rendez-vous n’est plus actif.')
    this.name = 'AppointmentNotActiveError'
  }
}
