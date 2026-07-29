'use client'

import { useActionState, useState } from 'react'
import { useFormStatus } from 'react-dom'
import { requestMagicLink, type ActionState } from './actions'

const initialState: ActionState = { error: null }

function SubmitButton() {
  const { pending } = useFormStatus()
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-md border border-slate-300 px-4 py-2.5 font-medium disabled:opacity-60"
    >
      {pending ? 'Envoi…' : 'Recevoir un lien de connexion'}
    </button>
  )
}

/**
 * Connexion sans mot de passe.
 *
 * Le message de confirmation est volontairement identique que l'adresse existe
 * ou non : le distinguer permettrait d'énumérer les comptes.
 */
export function MagicLinkForm() {
  const [state, formAction] = useActionState(requestMagicLink, initialState)
  const [open, setOpen] = useState(false)

  if (state.sent) {
    return (
      <p
        role="status"
        className="mt-6 rounded-md bg-emerald-50 px-4 py-3 text-sm text-emerald-800"
      >
        Si un compte existe pour cette adresse, un lien de connexion vient d’y être
        envoyé. Il expire dans 15 minutes.
      </p>
    )
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-6 text-sm text-slate-600 underline"
      >
        Se connecter sans mot de passe
      </button>
    )
  }

  return (
    <form action={formAction} className="mt-6 border-t border-slate-200 pt-6">
      <h2 className="text-sm font-medium">Connexion sans mot de passe</h2>
      <p className="mt-1 text-sm text-slate-600">
        Nous vous envoyons un lien à usage unique.
      </p>

      {state.error && (
        <p
          role="alert"
          className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-800"
        >
          {state.error}
        </p>
      )}

      <div className="mt-3 flex flex-col gap-1.5">
        <label htmlFor="magic-email" className="text-sm font-medium">
          Adresse électronique
        </label>
        <input
          id="magic-email"
          name="email"
          type="email"
          autoComplete="email"
          required
          className="rounded-md border border-slate-300 px-3 py-2"
        />
      </div>

      <div className="mt-3">
        <SubmitButton />
      </div>
    </form>
  )
}
