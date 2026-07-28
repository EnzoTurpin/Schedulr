'use server'

import { redirect } from 'next/navigation'
import { requireActor, UnauthenticatedError } from '@/lib/auth/actor'
import { clearSessionCookie } from '@/lib/auth/session'
import { ActiveMembershipError, eraseAccount } from './dataSubject'

/** Frontière HTTP des droits des personnes. */

export type PrivacyResult = { ok: false; error: string }

/**
 * Efface le compte, puis déconnecte.
 *
 * Ne retourne rien en cas de succès : la redirection interrompt l'exécution.
 */
export async function eraseAccountAction(): Promise<PrivacyResult> {
  try {
    const actor = await requireActor()
    await eraseAccount(actor)
    await clearSessionCookie()
  } catch (error) {
    if (error instanceof ActiveMembershipError) {
      return { ok: false, error: error.message }
    }
    if (error instanceof UnauthenticatedError) {
      return { ok: false, error: 'Session expirée. Reconnectez-vous.' }
    }
    console.error('eraseAccountAction', { error })
    return { ok: false, error: 'La suppression a échoué. Réessayez.' }
  }

  // Hors du bloc `try` : `redirect` lève une exception que le `catch`
  // intercepterait, transformant une réussite en erreur.
  redirect('/?compte=supprime')
}
