'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { requireActor, UnauthenticatedError } from '@/lib/auth/actor'
import { recordConsent } from './consent'

/**
 * Frontière HTTP des consentements.
 *
 * Un client ne décide que pour lui-même : l'identité vient de la session,
 * jamais du formulaire.
 */

const schema = z.object({
  type: z.enum(['TRANSACTIONAL_SMS', 'MARKETING_EMAIL', 'MARKETING_SMS']),
  granted: z.boolean(),
})

export type ConsentResult = { ok: true } | { ok: false; error: string }

export async function setConsentAction(raw: unknown): Promise<ConsentResult> {
  const parsed = schema.safeParse(raw)
  if (!parsed.success) return { ok: false, error: 'Requête invalide.' }

  try {
    const actor = await requireActor()
    await recordConsent(actor, parsed.data.type, parsed.data.granted, 'espace client')
    revalidatePath('/mon-compte')
    return { ok: true }
  } catch (error) {
    if (error instanceof UnauthenticatedError) {
      return { ok: false, error: 'Session expirée. Reconnectez-vous.' }
    }
    console.error('setConsentAction', { error })
    return { ok: false, error: 'L’enregistrement a échoué.' }
  }
}
