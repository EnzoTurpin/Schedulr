import type { Interval } from './intervals'

/**
 * Entrées du moteur de disponibilité.
 *
 * Le moteur ne connaît ni Prisma ni HTTP : il reçoit ces structures déjà
 * chargées et rend des créneaux. C'est cette frontière qui le rend testable
 * exhaustivement (ADR-0003).
 */

/** Plage horaire récurrente, en minutes locales depuis minuit. */
export type RecurringRange = {
  /** 0 = dimanche, convention `Date.getDay()`. */
  dayOfWeek: number
  startMin: number
  endMin: number
}

/** Règles de réservation du salon. */
export type SalonRules = {
  timezone: string
  /** Délai minimum entre maintenant et le début d'un rendez-vous. */
  bookingLeadTimeMin: number
  /** Horizon maximum de réservation, en jours. */
  bookingHorizonDays: number
  /** Granularité des départs proposés, en minutes. */
  slotStepMin: number
}

/** Un coiffeur, avec ses règles de temps propres. */
export type StaffAvailability = {
  memberId: string
  /** Horaires de travail récurrents. */
  workingHours: RecurringRange[]
  /** Absences ponctuelles (congés, formations), en instants absolus. */
  timeOff: Interval[]
  /** Rendez-vous déjà pris, marges comprises, en instants absolus. */
  busy: Interval[]
  /**
   * Durée totale de la prestation demandée pour ce coiffeur, marges comprises.
   * Dépend du couple prestation/coiffeur : une coloration prend plus de temps
   * chez un apprenti.
   */
  totalDurationMin: number
}

export type AvailabilityInput = {
  salon: SalonRules
  /** Horaires d'ouverture du salon, récurrents. */
  openingHours: RecurringRange[]
  /** Fermetures exceptionnelles du salon, en instants absolus. */
  closures: Interval[]
  staff: StaffAvailability[]
  /** Fenêtre demandée. */
  from: Date
  to: Date
  /** Instant de référence, injecté pour que les tests soient déterministes. */
  now: Date
}

/** Un créneau réservable. */
export type Slot = {
  /** Instant de départ, en millisecondes epoch. */
  startAt: number
  /** Instant de fin, marges comprises. */
  endAt: number
  memberId: string
}

/** Créneaux d'un coiffeur, regroupés. */
export type StaffSlots = {
  memberId: string
  slots: Slot[]
}
