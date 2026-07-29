'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { requireActor, UnauthenticatedError } from '@/lib/auth/actor'
import { createVerificationToken } from '@/lib/auth/emailVerification'
import { clearSessionCookie } from '@/lib/auth/session'
import {
  buildVerificationEmail,
  sendAuthEmail,
} from '@/features/notifications/authEmails'
import { prisma } from '@/lib/db/client'
import { profileSchema, updateProfile } from './profile'
import {
  changePassword,
  InvalidPasswordError,
  passwordChangeSchema,
  signOutEverywhere,
} from './security'

/**
 * Frontière HTTP du profil.
 *
 * L'identité vient de la session, jamais du formulaire : un compte ne modifie
 * que le sien.
 */

export type ProfileResult = { ok: true } | { ok: false; error: string }

export async function saveProfileAction(raw: unknown): Promise<ProfileResult> {
  const parsed = profileSchema.safeParse(raw)
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Formulaire invalide.' }
  }

  try {
    const actor = await requireActor()
    await updateProfile(actor, parsed.data)
    revalidatePath('/mon-compte')
    return { ok: true }
  } catch (error) {
    if (error instanceof UnauthenticatedError) {
      return { ok: false, error: 'Session expirée. Reconnectez-vous.' }
    }
    // Aucune donnée du formulaire dans le journal : il porte un nom et un
    // numéro de téléphone (CLAUDE.md).
    console.error('saveProfileAction', { error })
    return { ok: false, error: 'L’enregistrement a échoué. Réessayez.' }
  }
}

export async function changePasswordAction(raw: unknown): Promise<ProfileResult> {
  const parsed = passwordChangeSchema.safeParse(raw)
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Formulaire invalide.' }
  }

  try {
    const actor = await requireActor()
    await changePassword(actor, parsed.data)
  } catch (error) {
    if (error instanceof InvalidPasswordError) {
      return { ok: false, error: error.message }
    }
    if (error instanceof UnauthenticatedError) {
      return { ok: false, error: 'Session expirée. Reconnectez-vous.' }
    }
    // Jamais le mot de passe dans le journal (CLAUDE.md).
    console.error('changePasswordAction', { error })
    return { ok: false, error: 'Le changement a échoué. Réessayez.' }
  }

  // Hors du `try` : `redirect` lève, et le `catch` prendrait la réussite pour
  // un échec. Toutes les sessions ont été fermées, celle-ci comprise.
  await clearSessionCookie()
  redirect('/connexion?motdepasse=change')
}

export async function signOutEverywhereAction(): Promise<ProfileResult> {
  try {
    const actor = await requireActor()
    await signOutEverywhere(actor)
  } catch (error) {
    if (error instanceof UnauthenticatedError) {
      return { ok: false, error: 'Session expirée. Reconnectez-vous.' }
    }
    console.error('signOutEverywhereAction', { error })
    return { ok: false, error: 'La déconnexion a échoué. Réessayez.' }
  }

  await clearSessionCookie()
  redirect('/connexion?sessions=fermees')
}

/**
 * Renvoie le courriel de confirmation d'adresse.
 *
 * Le premier a pu se perdre, ou l'adresse avoir été corrigée depuis.
 */
export async function resendVerificationAction(): Promise<ProfileResult> {
  try {
    const actor = await requireActor()
    const user = await prisma.user.findUniqueOrThrow({
      where: { id: actor.userId },
      select: { email: true, emailVerified: true },
    })

    if (user.emailVerified) return { ok: true }

    await sendAuthEmail(
      buildVerificationEmail(user.email, await createVerificationToken(user.email)),
    )
    return { ok: true }
  } catch (error) {
    if (error instanceof UnauthenticatedError) {
      return { ok: false, error: 'Session expirée. Reconnectez-vous.' }
    }
    console.error('resendVerificationAction', { error })
    return { ok: false, error: 'L’envoi a échoué. Réessayez.' }
  }
}
