'use server'

import { z } from 'zod'
import { buildInvitationEmail, sendAuthEmail } from '@/features/notifications/authEmails'
import { requireActor } from '@/lib/auth/actor'
import { inviteMember, revokeInvitation } from '../invitations'
import {
  cancelUpcomingAppointments,
  countUpcomingAppointments,
  transferUpcomingAppointments,
} from '../memberAppointments'
import { revalidateSalon, salonId, toError, type ConfigResult } from './shared'

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

/**
 * Rendez-vous à venir d'un membre, pour l'avertissement de désactivation.
 */
export async function countUpcomingAction(
  raw: unknown,
): Promise<{ ok: true; count: number } | { ok: false; error: string }> {
  const parsed = z.object({ salonId, memberId: z.string().min(1) }).safeParse(raw)
  if (!parsed.success) return { ok: false, error: 'Requête invalide.' }

  try {
    const actor = await requireActor()
    const count = await countUpcomingAppointments(
      actor,
      parsed.data.salonId,
      parsed.data.memberId,
    )
    return { ok: true, count }
  } catch (error) {
    const failure = toError(error, { salonId: parsed.data.salonId })
    return failure.ok ? { ok: false, error: 'Lecture impossible.' } : failure
  }
}

export async function transferAppointmentsAction(
  raw: unknown,
): Promise<{ ok: true; moved: number; failed: number } | { ok: false; error: string }> {
  const parsed = z
    .object({ salonId, fromMemberId: z.string().min(1), toMemberId: z.string().min(1) })
    .safeParse(raw)
  if (!parsed.success) return { ok: false, error: 'Requête invalide.' }

  if (parsed.data.fromMemberId === parsed.data.toMemberId) {
    return { ok: false, error: 'Choisissez un autre coiffeur que celui-ci.' }
  }

  try {
    const actor = await requireActor()
    const result = await transferUpcomingAppointments(
      actor,
      parsed.data.salonId,
      parsed.data.fromMemberId,
      parsed.data.toMemberId,
    )
    revalidateSalon(parsed.data.salonId)
    return { ok: true, moved: result.moved, failed: result.failed.length }
  } catch (error) {
    const failure = toError(error, { salonId: parsed.data.salonId })
    return failure.ok ? { ok: false, error: 'Transfert impossible.' } : failure
  }
}

export async function cancelAppointmentsAction(raw: unknown): Promise<ConfigResult> {
  const parsed = z.object({ salonId, memberId: z.string().min(1) }).safeParse(raw)
  if (!parsed.success) return { ok: false, error: 'Requête invalide.' }

  try {
    const actor = await requireActor()
    await cancelUpcomingAppointments(actor, parsed.data.salonId, parsed.data.memberId)
    revalidateSalon(parsed.data.salonId)
    return { ok: true }
  } catch (error) {
    return toError(error, { salonId: parsed.data.salonId })
  }
}
