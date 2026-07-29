'use client'

import { useState, useTransition } from 'react'
import { changePasswordAction, signOutEverywhereAction } from './actions'

/**
 * Mot de passe et sessions.
 *
 * Les deux commandes ferment la session courante : le dire avant l'action vaut
 * mieux qu'une déconnexion inexpliquée.
 */

export function SecurityPanel({ activeSessions }: { activeSessions: number }) {
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  return (
    <div>
      {error && (
        <p
          role="alert"
          className="mb-4 rounded-md bg-red-50 px-4 py-3 text-sm text-red-800"
        >
          {error}
        </p>
      )}

      <form
        action={(formData) => {
          setError(null)
          startTransition(async () => {
            // En cas de succès l'action redirige : rien ne revient ici.
            const result = await changePasswordAction({
              currentPassword: String(formData.get('currentPassword') ?? ''),
              newPassword: String(formData.get('newPassword') ?? ''),
            })
            if (result && !result.ok) setError(result.error)
          })
        }}
      >
        <div className="grid max-w-md gap-4">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="currentPassword" className="text-sm font-medium">
              Mot de passe actuel
            </label>
            <input
              id="currentPassword"
              name="currentPassword"
              type="password"
              autoComplete="current-password"
              required
              className="rounded-md border border-slate-300 px-3 py-2"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="newPassword" className="text-sm font-medium">
              Nouveau mot de passe
            </label>
            <input
              id="newPassword"
              name="newPassword"
              type="password"
              autoComplete="new-password"
              required
              minLength={12}
              aria-describedby="aide-motdepasse"
              className="rounded-md border border-slate-300 px-3 py-2"
            />
            <p id="aide-motdepasse" className="text-xs text-slate-500">
              Douze caractères au minimum. Toutes vos sessions seront fermées, y compris
              celle-ci.
            </p>
          </div>
        </div>

        <button
          type="submit"
          disabled={pending}
          className="bg-brand-600 hover:bg-brand-700 mt-4 rounded-md px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {pending ? 'Modification…' : 'Changer mon mot de passe'}
        </button>
      </form>

      <div className="mt-8 border-t border-slate-200 pt-6">
        <h3 className="font-medium">Sessions ouvertes</h3>
        <p className="mt-1 text-sm text-slate-600">
          {activeSessions > 1
            ? `${activeSessions} sessions sont ouvertes sur vos appareils.`
            : 'Une seule session est ouverte : celle-ci.'}{' '}
          Fermez-les toutes si vous pensez qu’un autre appareil a accès à votre compte.
        </p>
        <form
          action={() => {
            setError(null)
            startTransition(async () => {
              const result = await signOutEverywhereAction()
              if (result && !result.ok) setError(result.error)
            })
          }}
        >
          <button
            type="submit"
            disabled={pending}
            className="mt-3 rounded-md border border-slate-300 px-4 py-2 text-sm disabled:opacity-50"
          >
            Fermer toutes mes sessions
          </button>
        </form>
      </div>
    </div>
  )
}
