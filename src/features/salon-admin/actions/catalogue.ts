'use server'

import { z } from 'zod'
import { requireActor } from '@/lib/auth/actor'
import {
  createCategory,
  createService,
  deleteCategory,
  renameCategory,
  setServiceActive,
  updateService,
} from '../services'
import { revalidateSalon, salonId, toError, type ConfigResult } from './shared'

// --- Catalogue ---------------------------------------------------------------

const serviceSchema = z.object({
  salonId,
  serviceId: z.string().min(1).optional(),
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).optional(),
  categoryId: z.string().min(1).nullable().optional(),
  durationMin: z.number().int().min(5).max(600),
  bufferBeforeMin: z.number().int().min(0).max(120),
  bufferAfterMin: z.number().int().min(0).max(120),
  priceCents: z.number().int().min(0).max(1_000_000),
})

export async function saveServiceAction(raw: unknown): Promise<ConfigResult> {
  const parsed = serviceSchema.safeParse(raw)
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Formulaire invalide.' }
  }

  const { salonId: id, serviceId, ...input } = parsed.data
  try {
    const actor = await requireActor()
    const payload = {
      ...input,
      description: input.description ?? null,
      categoryId: input.categoryId ?? null,
    }

    if (serviceId) {
      await updateService(actor, id, serviceId, payload)
    } else {
      await createService(actor, id, payload)
    }

    revalidateSalon(id)
    return { ok: true }
  } catch (error) {
    return toError(error, { salonId: id })
  }
}

const toggleSchema = z.object({
  salonId,
  serviceId: z.string().min(1),
  isActive: z.boolean(),
})

export async function toggleServiceAction(raw: unknown): Promise<ConfigResult> {
  const parsed = toggleSchema.safeParse(raw)
  if (!parsed.success) return { ok: false, error: 'Requête invalide.' }

  try {
    const actor = await requireActor()
    await setServiceActive(
      actor,
      parsed.data.salonId,
      parsed.data.serviceId,
      parsed.data.isActive,
    )
    revalidateSalon(parsed.data.salonId)
    return { ok: true }
  } catch (error) {
    return toError(error, { salonId: parsed.data.salonId })
  }
}

const categorySchema = z.object({ salonId, name: z.string().trim().min(1).max(80) })

export async function createCategoryAction(raw: unknown): Promise<ConfigResult> {
  const parsed = categorySchema.safeParse(raw)
  if (!parsed.success) return { ok: false, error: 'Nom de catégorie invalide.' }

  try {
    const actor = await requireActor()
    await createCategory(actor, parsed.data.salonId, parsed.data.name)
    revalidateSalon(parsed.data.salonId)
    return { ok: true }
  } catch (error) {
    return toError(error, { salonId: parsed.data.salonId })
  }
}

export async function deleteCategoryAction(raw: unknown): Promise<ConfigResult> {
  const parsed = z.object({ salonId, categoryId: z.string().min(1) }).safeParse(raw)
  if (!parsed.success) return { ok: false, error: 'Requête invalide.' }

  try {
    const actor = await requireActor()
    await deleteCategory(actor, parsed.data.salonId, parsed.data.categoryId)
    revalidateSalon(parsed.data.salonId)
    return { ok: true }
  } catch (error) {
    return toError(error, { salonId: parsed.data.salonId })
  }
}

export async function renameCategoryAction(raw: unknown): Promise<ConfigResult> {
  const parsed = z
    .object({
      salonId,
      categoryId: z.string().min(1),
      name: z.string().trim().min(1, 'Nom requis').max(80),
    })
    .safeParse(raw)
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Nom invalide.' }
  }

  try {
    const actor = await requireActor()
    await renameCategory(
      actor,
      parsed.data.salonId,
      parsed.data.categoryId,
      parsed.data.name,
    )
    revalidateSalon(parsed.data.salonId)
    return { ok: true }
  } catch (error) {
    return toError(error, { salonId: parsed.data.salonId })
  }
}
