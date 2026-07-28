'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { setConsentAction } from './actions'

/**
 * Consentement aux SMS transactionnels.
 *
 * Non coché par défaut : le consentement est un acte positif, une case
 * pré-cochée ne vaudrait pas accord (RGPD).
 */
export function ConsentToggle({
  granted,
  hasPhone,
}: {
  granted: boolean
  hasPhone: boolean
}) {
  const router = useRouter()
  const [checked, setChecked] = useState(granted)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  // La valeur du serveur prime après un rechargement, sans quoi l'état local
  // masquerait une modification faite ailleurs.
  const [lastGranted, setLastGranted] = useState(granted)
  if (lastGranted !== granted) {
    setLastGranted(granted)
    setChecked(granted)
  }

  function toggle(next: boolean) {
    setError(null)
    // Mise à jour optimiste : la case suit le clic immédiatement. Sans cela,
    // elle resterait figée jusqu'à la réponse du serveur et l'utilisateur
    // cliquerait plusieurs fois.
    setChecked(next)

    startTransition(async () => {
      const result = await setConsentAction({ type: 'TRANSACTIONAL_SMS', granted: next })
      if (!result.ok) {
        // Retour à l'état réel : l'affichage ne doit pas mentir.
        setChecked(!next)
        setError(result.error)
        return
      }
      router.refresh()
    })
  }

  return (
    <div>
      <label className="flex items-start gap-3">
        <input
          type="checkbox"
          checked={checked}
          disabled={pending || !hasPhone}
          onChange={(event) => toggle(event.target.checked)}
          aria-describedby="aide-sms"
          className="mt-0.5 size-4"
        />
        <span className="text-sm">
          Recevoir un rappel par SMS la veille de mes rendez-vous
          <span id="aide-sms" className="mt-1 block text-slate-500">
            {hasPhone
              ? 'Vous pouvez revenir sur ce choix à tout moment.'
              : 'Renseignez d’abord un numéro de téléphone dans votre profil.'}
          </span>
        </span>
      </label>
      {error && (
        <p role="alert" className="mt-2 text-sm text-red-800">
          {error}
        </p>
      )}
    </div>
  )
}
