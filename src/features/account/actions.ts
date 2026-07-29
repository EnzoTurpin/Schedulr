'use server'

import { revalidatePath } from 'next/cache'
import { requireActor, UnauthenticatedError } from '@/lib/auth/actor'
import { profileSchema, updateProfile } from './profile'

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
