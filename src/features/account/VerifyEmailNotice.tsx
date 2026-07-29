'use client'

import { useState, useTransition } from 'react'
import { resendVerificationAction } from './actions'

/**
 * Rappel d'une adresse non confirmée.
 *
 * Tant qu'elle ne l'est pas, aucun courriel de rendez-vous n'est envoyé — c'est
 * ce qui empêche un compte créé au nom d'un tiers de recevoir ses
 * notifications. Le compte reste utilisable : une adresse mal saisie ne doit
 * pas enfermer son auteur dehors.
 */
export function VerifyEmailNotice({ email }: { email: string }) {
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  return (
    <div className="rounded-md bg-amber-50 px-4 py-3 text-sm text-amber-900">
      <p>
        Votre adresse <strong>{email}</strong> n’est pas confirmée. Tant qu’elle ne l’est
        pas, vous ne recevrez ni confirmation ni rappel de rendez-vous.
      </p>

      {sent ? (
        <p role="status" className="mt-2">
          Courriel envoyé. Vérifiez votre boîte de réception.
        </p>
      ) : (
        <button
          type="button"
          disabled={pending}
          onClick={() => {
            setError(null)
            startTransition(async () => {
              const result = await resendVerificationAction()
              if (result.ok) setSent(true)
              else setError(result.error)
            })
          }}
          className="mt-2 underline disabled:opacity-60"
        >
          {pending ? 'Envoi…' : 'Renvoyer le courriel de confirmation'}
        </button>
      )}

      {error && (
        <p role="alert" className="mt-2 text-red-800">
          {error}
        </p>
      )}
    </div>
  )
}
