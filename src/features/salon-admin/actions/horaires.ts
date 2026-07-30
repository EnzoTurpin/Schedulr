'use server'

import { z } from 'zod'
import { requireActor } from '@/lib/auth/actor'
import {
  countAffectedAppointments,
  createClosure,
  deleteClosure,
  replaceOpeningHours,
} from '../schedule'
import { replaceWorkingHours } from '../team'
import {
  revalidateSalon,
  salonId,
  toError,
  toWeek,
  weekSchema,
  type ConfigResult,
} from './shared'

// --- Horaires ----------------------------------------------------------------

export async function saveOpeningHoursAction(raw: unknown): Promise<ConfigResult> {
  const parsed = z.object({ salonId, week: weekSchema }).safeParse(raw)
  if (!parsed.success) return { ok: false, error: 'Horaires invalides.' }

  try {
    const actor = await requireActor()
    await replaceOpeningHours(actor, parsed.data.salonId, toWeek(parsed.data.week))
    revalidateSalon(parsed.data.salonId)
    return { ok: true }
  } catch (error) {
    return toError(error, { salonId: parsed.data.salonId })
  }
}

export async function saveWorkingHoursAction(raw: unknown): Promise<ConfigResult> {
  const parsed = z
    .object({ salonId, memberId: z.string().min(1), week: weekSchema })
    .safeParse(raw)
  if (!parsed.success) return { ok: false, error: 'Horaires invalides.' }

  try {
    const actor = await requireActor()
    await replaceWorkingHours(
      actor,
      parsed.data.salonId,
      parsed.data.memberId,
      toWeek(parsed.data.week),
    )
    revalidateSalon(parsed.data.salonId)
    return { ok: true }
  } catch (error) {
    return toError(error, { salonId: parsed.data.salonId })
  }
}

const closureSchema = z.object({
  salonId,
  startAt: z.number().int().positive(),
  endAt: z.number().int().positive(),
  reason: z.string().trim().max(200).optional(),
})

export async function createClosureAction(raw: unknown): Promise<ConfigResult> {
  const parsed = closureSchema.safeParse(raw)
  if (!parsed.success) return { ok: false, error: 'Fermeture invalide.' }

  try {
    const actor = await requireActor()
    await createClosure(actor, parsed.data.salonId, {
      startAt: new Date(parsed.data.startAt),
      endAt: new Date(parsed.data.endAt),
      reason: parsed.data.reason ?? null,
    })
    revalidateSalon(parsed.data.salonId)
    return { ok: true }
  } catch (error) {
    return toError(error, { salonId: parsed.data.salonId })
  }
}

export async function deleteClosureAction(raw: unknown): Promise<ConfigResult> {
  const parsed = z.object({ salonId, closureId: z.string().min(1) }).safeParse(raw)
  if (!parsed.success) return { ok: false, error: 'Requête invalide.' }

  try {
    const actor = await requireActor()
    await deleteClosure(actor, parsed.data.salonId, parsed.data.closureId)
    revalidateSalon(parsed.data.salonId)
    return { ok: true }
  } catch (error) {
    return toError(error, { salonId: parsed.data.salonId })
  }
}

/**
 * Rendez-vous que de nouveaux horaires laisseraient hors ouverture.
 *
 * Consulté avant d'enregistrer : réduire une plage sans le savoir laisserait
 * des rendez-vous que le salon n'a plus les moyens d'honorer.
 */
export async function countAffectedAction(
  raw: unknown,
): Promise<{ ok: true; count: number } | { ok: false; error: string }> {
  const parsed = z
    .object({
      salonId,
      startAt: z.number().int().positive(),
      endAt: z.number().int().positive(),
    })
    .safeParse(raw)
  if (!parsed.success) return { ok: false, error: 'Requête invalide.' }

  try {
    const actor = await requireActor()
    const count = await countAffectedAppointments(actor, parsed.data.salonId, {
      startAt: new Date(parsed.data.startAt),
      endAt: new Date(parsed.data.endAt),
    })
    return { ok: true, count }
  } catch (error) {
    const failure = toError(error, { salonId: parsed.data.salonId })
    return failure.ok ? { ok: false, error: 'Lecture impossible.' } : failure
  }
}
