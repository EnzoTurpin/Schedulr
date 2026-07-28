'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { eraseAccountAction } from './actions'

/**
 * Exercice des droits d'accès et d'effacement.
 *
 * La suppression demande une confirmation par saisie : elle est irréversible et
 * ne doit pas partir sur un clic distrait.
 */

const CONFIRMATION = 'SUPPRIMER'

export function DataPanel() {
  const [confirming, setConfirming] = useState(false)
  const [typed, setTyped] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function erase() {
    setError(null)
    startTransition(async () => {
      // En cas de succès, l'action redirige : rien ne revient ici.
      const result = await eraseAccountAction()
      if (result && !result.ok) {
        setError(result.error)
      }
    })
  }

  return (
    <div>
      <p className="text-sm text-slate-600">
        Vous pouvez télécharger l’ensemble de vos données ou supprimer votre compte. Voir
        la{' '}
        <Link href="/confidentialite" className="underline">
          politique de confidentialité
        </Link>
        .
      </p>

      <div className="mt-4 flex flex-wrap gap-3">
        <Link
          href="/api/mon-compte/donnees"
          prefetch={false}
          className="rounded-md border border-slate-300 px-4 py-2 text-sm"
        >
          Télécharger mes données
        </Link>

        {!confirming && (
          <button
            type="button"
            onClick={() => setConfirming(true)}
            className="rounded-md border border-red-300 px-4 py-2 text-sm text-red-700"
          >
            Supprimer mon compte
          </button>
        )}
      </div>

      {error && (
        <p
          role="alert"
          className="mt-4 rounded-md bg-red-50 px-4 py-3 text-sm text-red-800"
        >
          {error}
        </p>
      )}

      {confirming && (
        <div className="mt-4 rounded-md border border-red-300 bg-red-50 p-4">
          <h3 className="font-medium text-red-900">Supprimer définitivement ?</h3>
          <p className="mt-2 text-sm text-red-800">
            Votre identité et vos coordonnées seront effacées, et vous serez déconnecté.
            Vos rendez-vous passés resteront visibles du salon sous forme anonyme, pour sa
            comptabilité. Cette action est irréversible.
          </p>

          <div className="mt-4 flex flex-col gap-1.5">
            <label htmlFor="confirmation" className="text-sm font-medium text-red-900">
              Saisissez « {CONFIRMATION} » pour confirmer
            </label>
            <input
              id="confirmation"
              value={typed}
              onChange={(event) => setTyped(event.target.value)}
              autoComplete="off"
              className="max-w-xs rounded-md border border-red-300 px-3 py-2"
            />
          </div>

          <div className="mt-4 flex gap-3">
            <button
              type="button"
              onClick={erase}
              disabled={pending || typed !== CONFIRMATION}
              className="rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
            >
              {pending ? 'Suppression…' : 'Supprimer mon compte'}
            </button>
            <button
              type="button"
              onClick={() => {
                setConfirming(false)
                setTyped('')
              }}
              className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm"
            >
              Annuler
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
