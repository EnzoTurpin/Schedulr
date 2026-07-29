'use client'

import { useEffect } from 'react'
import Link from 'next/link'

/**
 * Erreur inattendue au sein d'une page.
 *
 * Aucun détail technique n'est affiché : une trace d'exécution renseigne un
 * attaquant sur la structure interne (CLAUDE.md). Le `digest` est en revanche
 * montré, car c'est lui qui permet de retrouver l'incident côté serveur.
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    // Journalisé côté client faute de collecteur : le raccordement à Sentry
    // reste à faire (voir les points en attente du plan d'action).
    console.error('Erreur de rendu', { digest: error.digest })
  }, [error])

  return (
    <div className="mx-auto flex min-h-dvh max-w-2xl flex-col justify-center px-6 py-16">
      <p className="text-sm font-medium text-slate-500">Erreur</p>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight">
        Cette page n’a pas pu s’afficher
      </h1>
      <p className="mt-3 text-slate-600">
        L’incident a été enregistré. Vos rendez-vous ne sont pas affectés.
      </p>

      {error.digest && (
        <p className="mt-4 text-sm text-slate-500">
          Référence : <code className="font-mono">{error.digest}</code>
        </p>
      )}

      <div className="mt-8 flex flex-wrap items-center gap-4 text-sm">
        <button
          type="button"
          onClick={reset}
          className="bg-brand-600 hover:bg-brand-700 rounded-md px-4 py-2 font-medium text-white"
        >
          Réessayer
        </button>
        <Link href="/" className="text-brand-700 underline">
          Retour à l’accueil
        </Link>
      </div>
    </div>
  )
}
