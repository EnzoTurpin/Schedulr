'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { buildInvitationEmail, sendAuthEmail } from '@/features/notifications/authEmails'
import { requireActor, UnauthenticatedError } from '@/lib/auth/actor'
import { ForbiddenError, ResourceNotFoundError } from '@/lib/authz/types'
import {
  createClosure,
  deleteClosure,
  InvalidScheduleError,
  replaceOpeningHours,
} from './schedule'
import {
  createCategory,
  createService,
  deleteCategory,
  setServiceActive,
  updateService,
} from './services'
import { ALLOWED_SLOT_STEPS } from './constants'
import {
  InvalidSettingsError,
  updateBookingSettings,
  updateSalonProfile,
} from './settings'
import { AlreadyLinkedError, inviteMember, revokeInvitation } from './invitations'
import {
  createMember,
  createTimeOff,
  deactivateMember,
  deleteTimeOff,
  replaceWorkingHours,
  setMemberServices,
  updateMember,
} from './team'

/**
 * Frontière HTTP de la configuration du salon.
 *
 * Authentifie, valide, délègue. Les règles métier vivent dans les modules
 * voisins, testés sans passer par Next.js (ADR-0001).
 */

export type ConfigResult = { ok: true } | { ok: false; error: string }

function toError(error: unknown, context: Record<string, string>): ConfigResult {
  if (error instanceof AlreadyLinkedError) {
    return { ok: false, error: error.message }
  }
  // Erreurs de saisie : leur message est déjà rédigé pour l'utilisateur.
  if (error instanceof InvalidScheduleError || error instanceof InvalidSettingsError) {
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

  console.error('salon-admin', { ...context, error })
  return { ok: false, error: 'L’enregistrement a échoué. Réessayez.' }
}

/** Rafraîchit la configuration et l'agenda, tous deux affectés. */
function revalidateSalon(salonId: string) {
  revalidatePath(`/pro/${salonId}/configuration`)
  revalidatePath(`/pro/${salonId}`)
}

const salonId = z.string().min(1)

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

// --- Horaires ----------------------------------------------------------------

const weekSchema = z.record(
  z.string().regex(/^[0-6]$/),
  z.array(
    z.object({
      startMin: z.number().int().min(0).max(2880),
      endMin: z.number().int().min(0).max(2880),
    }),
  ),
)

/** Convertit les clés textuelles du formulaire en jours numériques. */
function toWeek(raw: z.infer<typeof weekSchema>) {
  return Object.fromEntries(
    Object.entries(raw).map(([day, ranges]) => [Number(day), ranges ?? []]),
  )
}

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

// --- Invitations -------------------------------------------------------------

const inviteSchema = z.object({
  salonId,
  memberId: z.string().min(1),
  email: z.string().trim().min(3).includes('@'),
})

export async function inviteMemberAction(raw: unknown): Promise<ConfigResult> {
  const parsed = inviteSchema.safeParse(raw)
  if (!parsed.success) return { ok: false, error: 'Adresse électronique invalide.' }

  try {
    const actor = await requireActor()
    const invitation = await inviteMember(
      actor,
      parsed.data.salonId,
      parsed.data.memberId,
      parsed.data.email,
    )

    // L'envoi n'interrompt pas l'invitation : elle est créée en base, le lien
    // peut être renvoyé si le courriel n'arrive pas.
    await sendAuthEmail(
      buildInvitationEmail(
        invitation.email,
        invitation.token,
        invitation.salonName,
        invitation.memberName,
      ),
    )

    revalidateSalon(parsed.data.salonId)
    return { ok: true }
  } catch (error) {
    return toError(error, { salonId: parsed.data.salonId })
  }
}

export async function revokeInvitationAction(raw: unknown): Promise<ConfigResult> {
  const parsed = z.object({ salonId, memberId: z.string().min(1) }).safeParse(raw)
  if (!parsed.success) return { ok: false, error: 'Requête invalide.' }

  try {
    const actor = await requireActor()
    await revokeInvitation(actor, parsed.data.salonId, parsed.data.memberId)
    revalidateSalon(parsed.data.salonId)
    return { ok: true }
  } catch (error) {
    return toError(error, { salonId: parsed.data.salonId })
  }
}
