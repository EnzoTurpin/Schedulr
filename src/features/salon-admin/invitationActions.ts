'use server'

import { redirect } from 'next/navigation'
import { requireActor, UnauthenticatedError } from '@/lib/auth/actor'
import {
  EmailMismatchError,
  InvitationInvalidError,
  acceptInvitation,
} from './invitations'

/**
 * Acceptation d'une invitation.
 *
 * Isolée des autres actions de configuration : celles-ci exigent déjà
 * d'appartenir au salon, ce qui n'est justement pas encore le cas ici.
 */

export type AcceptResult = { ok: false; error: string }

export async function acceptInvitationAction(token: string): Promise<AcceptResult> {
  let salonId: string

  try {
    const actor = await requireActor()
    salonId = await acceptInvitation(actor, token)
  } catch (error) {
    if (error instanceof InvitationInvalidError || error instanceof EmailMismatchError) {
      return { ok: false, error: error.message }
    }
    if (error instanceof UnauthenticatedError) {
      return { ok: false, error: 'Connectez-vous pour accepter cette invitation.' }
    }
    console.error('acceptInvitationAction', { error })
    return { ok: false, error: 'L’acceptation a échoué. Réessayez.' }
  }

  // Hors du bloc `try` : `redirect` lève une exception que le `catch`
  // intercepterait, transformant une réussite en erreur.
  redirect(`/pro/${salonId}`)
}
