'use server'

import { z } from 'zod'
import { requireActor } from '@/lib/auth/actor'
import {
  createTimeOff,
  createMember,
  deactivateMember,
  deleteTimeOff,
  setMemberServices,
  setServiceOverride,
  updateMember,
} from '../team'
import { revalidateSalon, salonId, toError, type ConfigResult } from './shared'

// --- Équipe ------------------------------------------------------------------

const memberSchema = z.object({
  salonId,
  memberId: z.string().min(1).optional(),
  displayName: z.string().trim().min(1).max(80),
  bio: z.string().trim().max(500).optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Couleur invalide.'),
  role: z.enum(['OWNER', 'MANAGER', 'STAFF']),
  isBookable: z.boolean(),
})

export async function saveMemberAction(raw: unknown): Promise<ConfigResult> {
  const parsed = memberSchema.safeParse(raw)
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Formulaire invalide.' }
  }

  const { salonId: id, memberId, ...input } = parsed.data
  try {
    const actor = await requireActor()
    const payload = { ...input, bio: input.bio ?? null }

    if (memberId) {
      await updateMember(actor, id, memberId, payload)
    } else {
      await createMember(actor, id, payload)
    }

    revalidateSalon(id)
    return { ok: true }
  } catch (error) {
    return toError(error, { salonId: id })
  }
}

export async function deactivateMemberAction(raw: unknown): Promise<ConfigResult> {
  const parsed = z.object({ salonId, memberId: z.string().min(1) }).safeParse(raw)
  if (!parsed.success) return { ok: false, error: 'Requête invalide.' }

  try {
    const actor = await requireActor()
    await deactivateMember(actor, parsed.data.salonId, parsed.data.memberId)
    revalidateSalon(parsed.data.salonId)
    return { ok: true }
  } catch (error) {
    return toError(error, { salonId: parsed.data.salonId })
  }
}

export async function setMemberServicesAction(raw: unknown): Promise<ConfigResult> {
  const parsed = z
    .object({
      salonId,
      memberId: z.string().min(1),
      serviceIds: z.array(z.string().min(1)).max(200),
    })
    .safeParse(raw)
  if (!parsed.success) return { ok: false, error: 'Requête invalide.' }

  try {
    const actor = await requireActor()
    await setMemberServices(
      actor,
      parsed.data.salonId,
      parsed.data.memberId,
      parsed.data.serviceIds,
    )
    revalidateSalon(parsed.data.salonId)
    return { ok: true }
  } catch (error) {
    return toError(error, { salonId: parsed.data.salonId })
  }
}

const timeOffSchema = z.object({
  salonId,
  memberId: z.string().min(1),
  startAt: z.number().int().positive(),
  endAt: z.number().int().positive(),
  reason: z.string().trim().max(200).optional(),
})

export async function createTimeOffAction(raw: unknown): Promise<ConfigResult> {
  const parsed = timeOffSchema.safeParse(raw)
  if (!parsed.success) return { ok: false, error: 'Congé invalide.' }

  try {
    const actor = await requireActor()
    await createTimeOff(actor, parsed.data.salonId, {
      memberId: parsed.data.memberId,
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

export async function deleteTimeOffAction(raw: unknown): Promise<ConfigResult> {
  const parsed = z.object({ salonId, timeOffId: z.string().min(1) }).safeParse(raw)
  if (!parsed.success) return { ok: false, error: 'Requête invalide.' }

  try {
    const actor = await requireActor()
    await deleteTimeOff(actor, parsed.data.salonId, parsed.data.timeOffId)
    revalidateSalon(parsed.data.salonId)
    return { ok: true }
  } catch (error) {
    return toError(error, { salonId: parsed.data.salonId })
  }
}

/**
 * Durée et prix propres à un coiffeur pour une prestation.
 *
 * Une coloration prend plus de temps chez un apprenti, et le tarif peut suivre.
 * Le moteur de disponibilité honore déjà cette durée ; seule la saisie manquait.
 */
export async function setServiceOverrideAction(raw: unknown): Promise<ConfigResult> {
  const parsed = z
    .object({
      salonId,
      memberId: z.string().min(1),
      serviceId: z.string().min(1),
      // Nul rétablit la valeur du catalogue.
      durationMin: z.number().int().min(5).max(600).nullable(),
      priceCents: z.number().int().min(0).max(1_000_000).nullable(),
    })
    .safeParse(raw)
  if (!parsed.success) return { ok: false, error: 'Valeurs invalides.' }

  try {
    const actor = await requireActor()
    await setServiceOverride(
      actor,
      parsed.data.salonId,
      parsed.data.memberId,
      parsed.data.serviceId,
      { durationMin: parsed.data.durationMin, priceCents: parsed.data.priceCents },
    )
    revalidateSalon(parsed.data.salonId)
    return { ok: true }
  } catch (error) {
    return toError(error, { salonId: parsed.data.salonId })
  }
}
