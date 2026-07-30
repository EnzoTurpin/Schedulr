'use server'

import { z } from 'zod'
import { requireActor } from '@/lib/auth/actor'
import { ALLOWED_SLOT_STEPS } from '../constants'
import { updateBookingSettings, updateSalonProfile } from '../settings'
import { revalidateSalon, salonId, toError, type ConfigResult } from './shared'

// --- Fiche et paramètres -----------------------------------------------------

const profileSchema = z.object({
  salonId,
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(2000).optional(),
  address: z.string().trim().min(1).max(200),
  city: z.string().trim().min(1).max(100),
  postalCode: z.string().trim().min(1).max(20),
  phone: z.string().trim().max(30).optional(),
  email: z.string().trim().max(200).optional(),
})

export async function saveProfileAction(raw: unknown): Promise<ConfigResult> {
  const parsed = profileSchema.safeParse(raw)
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Formulaire invalide.' }
  }

  const { salonId: id, ...input } = parsed.data
  try {
    const actor = await requireActor()
    await updateSalonProfile(actor, id, {
      ...input,
      description: input.description ?? null,
      phone: input.phone ?? null,
      email: input.email ?? null,
    })
    revalidateSalon(id)
    return { ok: true }
  } catch (error) {
    return toError(error, { salonId: id })
  }
}

const bookingSchema = z.object({
  salonId,
  bookingLeadTimeMin: z.number().int().min(0),
  bookingHorizonDays: z.number().int().min(1),
  slotStepMin: z
    .number()
    .int()
    .refine((value) => (ALLOWED_SLOT_STEPS as readonly number[]).includes(value), {
      message: `Le pas doit valoir ${ALLOWED_SLOT_STEPS.join(', ')} minutes.`,
    }),
  cancellationDeadlineHours: z.number().int().min(0),
  smsMonthlyQuota: z.number().int().min(0),
})

export async function saveBookingSettingsAction(raw: unknown): Promise<ConfigResult> {
  const parsed = bookingSchema.safeParse(raw)
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? 'Paramètres invalides.',
    }
  }

  const { salonId: id, ...input } = parsed.data
  try {
    const actor = await requireActor()
    await updateBookingSettings(actor, id, input)
    revalidateSalon(id)
    return { ok: true }
  } catch (error) {
    return toError(error, { salonId: id })
  }
}
