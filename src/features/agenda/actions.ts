'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { requireActor, UnauthenticatedError } from '@/lib/auth/actor'
import { ForbiddenError, ResourceNotFoundError } from '@/lib/authz/types'
import { SlotConflictError } from '@/lib/db/errors'
import {
  createWalkIn,
  moveAppointment,
  resizeAppointment,
  setAppointmentStatus,
  setStaffNote,
} from './mutations'

/**
 * Frontière HTTP de l'agenda professionnel.
 *
 * Authentifie, valide, délègue. Les règles métier vivent dans `mutations.ts`,
 * testées sans passer par Next.js.
 */

export type AgendaResult<T = void> =
  | ({ ok: true } & (T extends void ? object : { data: T }))
  | { ok: false; error: string; conflict?: boolean }

/** Traduit une exception en réponse exploitable par l'interface. */
function toError(error: unknown, context: Record<string, string>): AgendaResult<never> {
  if (error instanceof SlotConflictError) {
    return {
      ok: false,
      error: 'Ce créneau chevauche un autre rendez-vous.',
      // Signale à l'interface qu'elle doit remettre le bloc à sa place.
      conflict: true,
    }
  }
  if (error instanceof UnauthenticatedError) {
    return { ok: false, error: 'Session expirée. Reconnectez-vous.' }
  }
  // Un membre d'un autre salon ne doit pas apprendre que la ressource existe.
  if (error instanceof ResourceNotFoundError) {
    return { ok: false, error: 'Rendez-vous introuvable.' }
  }
  if (error instanceof ForbiddenError) {
    return { ok: false, error: 'Vous n’avez pas les droits pour cette action.' }
  }

  console.error('agenda', { ...context, error })
  return { ok: false, error: 'L’opération a échoué. Réessayez.' }
}

const walkInSchema = z.object({
  salonId: z.string().min(1),
  memberId: z.string().min(1),
  serviceIds: z.array(z.string().min(1)).min(1).max(10),
  startAt: z.number().int().positive(),
  guestName: z.string().trim().min(1).max(120),
  guestPhone: z.string().trim().max(30).optional(),
  source: z.enum(['SALON', 'PHONE']),
  staffNote: z.string().max(1000).optional(),
})

export async function createWalkInAction(raw: unknown): Promise<AgendaResult<string>> {
  const parsed = walkInSchema.safeParse(raw)
  if (!parsed.success) {
    return { ok: false, error: 'Formulaire invalide.' }
  }

  try {
    const actor = await requireActor()
    const appointment = await createWalkIn(actor, {
      ...parsed.data,
      startAt: new Date(parsed.data.startAt),
    })

    revalidatePath('/pro')
    return { ok: true, data: appointment.id }
  } catch (error) {
    return toError(error, { salonId: parsed.data.salonId })
  }
}

const moveSchema = z.object({
  salonId: z.string().min(1),
  appointmentId: z.string().min(1),
  startAt: z.number().int().positive(),
  memberId: z.string().min(1).optional(),
})

export async function moveAppointmentAction(raw: unknown): Promise<AgendaResult> {
  const parsed = moveSchema.safeParse(raw)
  if (!parsed.success) {
    return { ok: false, error: 'Requête invalide.' }
  }

  try {
    const actor = await requireActor()
    await moveAppointment(actor, {
      ...parsed.data,
      startAt: new Date(parsed.data.startAt),
    })

    revalidatePath('/pro')
    return { ok: true }
  } catch (error) {
    return toError(error, { salonId: parsed.data.salonId })
  }
}

const resizeSchema = z.object({
  salonId: z.string().min(1),
  appointmentId: z.string().min(1),
  endAt: z.number().int().positive(),
})

export async function resizeAppointmentAction(raw: unknown): Promise<AgendaResult> {
  const parsed = resizeSchema.safeParse(raw)
  if (!parsed.success) {
    return { ok: false, error: 'Requête invalide.' }
  }

  try {
    const actor = await requireActor()
    await resizeAppointment(actor, {
      ...parsed.data,
      endAt: new Date(parsed.data.endAt),
    })

    revalidatePath('/pro')
    return { ok: true }
  } catch (error) {
    return toError(error, { salonId: parsed.data.salonId })
  }
}

const statusSchema = z.object({
  salonId: z.string().min(1),
  appointmentId: z.string().min(1),
  status: z.enum(['CONFIRMED', 'DONE', 'NO_SHOW', 'CANCELLED']),
})

export async function setStatusAction(raw: unknown): Promise<AgendaResult> {
  const parsed = statusSchema.safeParse(raw)
  if (!parsed.success) {
    return { ok: false, error: 'Requête invalide.' }
  }

  try {
    const actor = await requireActor()
    await setAppointmentStatus(actor, parsed.data)

    revalidatePath('/pro')
    return { ok: true }
  } catch (error) {
    return toError(error, { salonId: parsed.data.salonId })
  }
}

const noteSchema = z.object({
  salonId: z.string().min(1),
  appointmentId: z.string().min(1),
  staffNote: z.string().max(1000),
})

export async function setStaffNoteAction(raw: unknown): Promise<AgendaResult> {
  const parsed = noteSchema.safeParse(raw)
  if (!parsed.success) {
    return { ok: false, error: 'Requête invalide.' }
  }

  try {
    const actor = await requireActor()
    await setStaffNote(actor, parsed.data)

    revalidatePath('/pro')
    return { ok: true }
  } catch (error) {
    return toError(error, { salonId: parsed.data.salonId })
  }
}
