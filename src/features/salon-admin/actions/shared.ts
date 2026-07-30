import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { UnauthenticatedError } from '@/lib/auth/actor'
import { ForbiddenError, ResourceNotFoundError } from '@/lib/authz/types'
import { AlreadyLinkedError } from '../invitations'
import { PendingAppointmentsError } from '../memberAppointments'
import { InvalidScheduleError } from '../schedule'
import { InvalidSettingsError } from '../settings'

/**
 * Socle commun des actions de configuration.
 *
 * Volontairement hors d'un module « use server » : celui-ci ne peut exporter
 * que des fonctions asynchrones, ce qui exclut types et schémas.
 */

export type ConfigResult = { ok: true } | { ok: false; error: string }

export const salonId = z.string().min(1)

/** Semaine type, partagée par les horaires du salon et ceux des membres. */
export const weekSchema = z.record(
  z.string().regex(/^[0-6]$/),
  z.array(
    z.object({
      startMin: z.number().int().min(0).max(2880),
      endMin: z.number().int().min(0).max(2880),
    }),
  ),
)

export function toWeek(raw: z.infer<typeof weekSchema>) {
  return Object.fromEntries(
    Object.entries(raw).map(([day, ranges]) => [Number(day), ranges ?? []]),
  )
}

/**
 * Traduit une exception en message affichable.
 *
 * Les erreurs métier portent déjà un texte rédigé pour l'utilisateur ; les
 * autres sont journalisées et remplacées par un message neutre, une trace
 * d'exécution renseignant un attaquant sur la structure interne.
 */
export function toError(error: unknown, context: Record<string, string>): ConfigResult {
  if (error instanceof AlreadyLinkedError) {
    return { ok: false, error: error.message }
  }
  if (
    error instanceof InvalidScheduleError ||
    error instanceof InvalidSettingsError ||
    error instanceof PendingAppointmentsError
  ) {
    return { ok: false, error: error.message }
  }
  if (error instanceof UnauthenticatedError) {
    return { ok: false, error: 'Session expirée. Reconnectez-vous.' }
  }
  if (error instanceof ResourceNotFoundError) {
    return { ok: false, error: 'Élément introuvable.' }
  }
  if (error instanceof ForbiddenError) {
    return { ok: false, error: 'Vous n’avez pas les droits pour cette action.' }
  }

  console.error('salon-admin action', { ...context, error })
  return { ok: false, error: 'L’enregistrement a échoué. Réessayez.' }
}

/** Rafraîchit les écrans du salon après une écriture. */
export function revalidateSalon(id: string): void {
  revalidatePath(`/pro/${id}`)
  revalidatePath(`/pro/${id}/configuration`)
  revalidatePath(`/pro/${id}/configuration/horaires`)
  revalidatePath(`/pro/${id}/configuration/equipe`)
  revalidatePath(`/pro/${id}/configuration/parametres`)
}
