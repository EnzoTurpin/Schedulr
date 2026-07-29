import { invalidateSalon } from '@/features/availability'
import { assertCan } from '@/lib/authz/can'
import { type Actor } from '@/lib/authz/types'
import { crossSalon } from '@/lib/db/scoped'
import { ALLOWED_SLOT_STEPS } from './constants'

/**
 * Fiche du salon et paramètres de réservation.
 *
 * `Salon` n'est pas une table cloisonnée — c'est la table des tenants
 * elle-même. L'autorisation est donc contrôlée explicitement avant chaque
 * accès, et non déléguée au client scopé (voir `tenant-models.ts`).
 */

export type SalonProfileInput = {
  name: string
  description?: string | null
  address: string
  city: string
  postalCode: string
  phone?: string | null
  email?: string | null
}

export type BookingSettingsInput = {
  /** Délai minimum avant un rendez-vous réservé en ligne, en minutes. */
  bookingLeadTimeMin: number
  /** Horizon maximum de réservation, en jours. */
  bookingHorizonDays: number
  /** Granularité des créneaux proposés, en minutes. */
  slotStepMin: number
  /** Délai avant lequel le client peut encore annuler, en heures. */
  cancellationDeadlineHours: number
  /** Plafond mensuel de SMS. Zéro désactive le canal. */
  smsMonthlyQuota: number
}

export class InvalidSettingsError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'InvalidSettingsError'
  }
}

export { ALLOWED_SLOT_STEPS } from './constants'

export async function getSalonSettings(actor: Actor, salonId: string) {
  assertCan(actor, 'salon:update', { kind: 'salon', salonId })

  return crossSalon('configuration du salon').salon.findUnique({
    where: { id: salonId },
    select: {
      id: true,
      slug: true,
      name: true,
      description: true,
      address: true,
      city: true,
      postalCode: true,
      phone: true,
      email: true,
      timezone: true,
      isActive: true,
      bookingLeadTimeMin: true,
      bookingHorizonDays: true,
      slotStepMin: true,
      cancellationDeadlineHours: true,
      smsMonthlyQuota: true,
    },
  })
}

export async function updateSalonProfile(
  actor: Actor,
  salonId: string,
  input: SalonProfileInput,
) {
  assertCan(actor, 'salon:update', { kind: 'salon', salonId })

  const salon = await crossSalon('mise à jour de la fiche salon').salon.update({
    where: { id: salonId },
    data: {
      ...input,
      description: input.description ?? null,
      phone: input.phone ?? null,
      email: input.email ?? null,
    },
    select: { id: true, name: true },
  })

  // Le nom et l'adresse figurent sur la fiche publique servie depuis le cache.
  invalidateSalon(salonId)
  return salon
}

/**
 * Valide les paramètres de réservation.
 *
 * Les bornes ne sont pas décoratives : un horizon nul rendrait toute
 * réservation impossible, et un pas non divisible produirait des créneaux
 * décalés d'une prestation à l'autre.
 */
export function validateBookingSettings(input: BookingSettingsInput): void {
  if (input.bookingLeadTimeMin < 0 || input.bookingLeadTimeMin > 30 * 24 * 60) {
    throw new InvalidSettingsError(
      'Le délai minimum doit être compris entre 0 et 30 jours.',
    )
  }
  if (input.bookingHorizonDays < 1 || input.bookingHorizonDays > 365) {
    throw new InvalidSettingsError('L’horizon doit être compris entre 1 et 365 jours.')
  }
  if (
    !ALLOWED_SLOT_STEPS.includes(input.slotStepMin as (typeof ALLOWED_SLOT_STEPS)[number])
  ) {
    throw new InvalidSettingsError(
      `Le pas doit valoir ${ALLOWED_SLOT_STEPS.join(', ')} minutes.`,
    )
  }
  if (input.smsMonthlyQuota < 0 || input.smsMonthlyQuota > 100_000) {
    throw new InvalidSettingsError(
      'Le plafond de SMS doit être compris entre 0 et 100 000 par mois.',
    )
  }
  if (input.cancellationDeadlineHours < 0 || input.cancellationDeadlineHours > 168) {
    throw new InvalidSettingsError(
      'Le délai d’annulation doit être compris entre 0 et 168 heures.',
    )
  }

  // Un délai minimum supérieur à l'horizon ne laisserait jamais aucun créneau.
  if (input.bookingLeadTimeMin >= input.bookingHorizonDays * 24 * 60) {
    throw new InvalidSettingsError(
      'Le délai minimum dépasse l’horizon de réservation : aucun créneau ne serait proposé.',
    )
  }
}

export async function updateBookingSettings(
  actor: Actor,
  salonId: string,
  input: BookingSettingsInput,
) {
  assertCan(actor, 'salon:update', { kind: 'salon', salonId })
  validateBookingSettings(input)

  const salon = await crossSalon('paramètres de réservation').salon.update({
    where: { id: salonId },
    data: input,
    select: { id: true },
  })

  // Ces réglages gouvernent directement le calcul des créneaux.
  invalidateSalon(salonId)
  return salon
}
