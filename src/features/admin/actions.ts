'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { requireActor, UnauthenticatedError } from '@/lib/auth/actor'
import { ForbiddenError, ResourceNotFoundError } from '@/lib/authz/types'
import { SlugTakenError, createSalon, setSalonActive } from './mutations'

/** Frontière HTTP du back-office plateforme. */

export type AdminResult = { ok: true } | { ok: false; error: string }

function toError(error: unknown, context: Record<string, string>): AdminResult {
  if (error instanceof SlugTakenError) {
    return { ok: false, error: error.message }
  }
  if (error instanceof UnauthenticatedError) {
    return { ok: false, error: 'Session expirée. Reconnectez-vous.' }
  }
  if (error instanceof ResourceNotFoundError) {
    return { ok: false, error: 'Aucun compte ne correspond à cette adresse.' }
  }
  if (error instanceof ForbiddenError) {
    return { ok: false, error: 'Action réservée à l’administrateur.' }
  }
  console.error('admin', { ...context, error })
  return { ok: false, error: 'L’opération a échoué. Réessayez.' }
}

const createSchema = z.object({
  // Le slug apparaît dans l'URL publique : minuscules, chiffres et tirets.
  slug: z
    .string()
    .trim()
    .min(3)
    .max(60)
    .regex(/^[a-z0-9-]+$/, 'Adresse invalide : minuscules, chiffres et tirets.'),
  name: z.string().trim().min(1).max(120),
  address: z.string().trim().min(1).max(200),
  city: z.string().trim().min(1).max(100),
  postalCode: z.string().trim().min(1).max(20),
  ownerEmail: z.string().trim().min(3).includes('@'),
  ownerDisplayName: z.string().trim().min(1).max(80),
})

export async function createSalonAction(raw: unknown): Promise<AdminResult> {
  const parsed = createSchema.safeParse(raw)
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Formulaire invalide.' }
  }

  try {
    const actor = await requireActor()
    await createSalon(actor, parsed.data)
    revalidatePath('/admin/salons')
    return { ok: true }
  } catch (error) {
    return toError(error, { slug: parsed.data.slug })
  }
}

const toggleSchema = z.object({
  salonId: z.string().min(1),
  isActive: z.boolean(),
  reason: z.string().trim().max(200).optional(),
})

export async function setSalonActiveAction(raw: unknown): Promise<AdminResult> {
  const parsed = toggleSchema.safeParse(raw)
  if (!parsed.success) return { ok: false, error: 'Requête invalide.' }

  try {
    const actor = await requireActor()
    await setSalonActive(
      actor,
      parsed.data.salonId,
      parsed.data.isActive,
      parsed.data.reason,
    )
    revalidatePath('/admin/salons')
    return { ok: true }
  } catch (error) {
    return toError(error, { salonId: parsed.data.salonId })
  }
}
