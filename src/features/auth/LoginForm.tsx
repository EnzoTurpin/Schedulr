'use client'

import { useActionState } from 'react'
import { useFormStatus } from 'react-dom'
import { login, type ActionState } from './actions'

const initialState: ActionState = { error: null }

function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus()
  return (
    <button
      type="submit"
      disabled={pending}
      className="bg-brand-600 hover:bg-brand-700 mt-2 rounded-md px-4 py-2.5 font-medium text-white disabled:opacity-60"
    >
      {pending ? 'Connexion…' : label}
    </button>
  )
}

export function LoginForm({ suite }: { suite?: string }) {
  const [state, formAction] = useActionState(login, initialState)

  return (
    <form action={formAction} className="mt-8 flex flex-col gap-4">
      {/* Destination d'origine, revalidée côté serveur avant redirection. */}
      {suite && <input type="hidden" name="suite" value={suite} />}
      {/* role="alert" : l'erreur est annoncée aux lecteurs d'écran à son
          apparition, sans quoi elle passerait inaperçue. */}
      {state.error && (
        <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">
          {state.error}
        </p>
      )}

      <div className="flex flex-col gap-1.5">
        <label htmlFor="email" className="text-sm font-medium">
          Adresse électronique
        </label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          className="rounded-md border border-slate-300 px-3 py-2"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="password" className="text-sm font-medium">
          Mot de passe
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          className="rounded-md border border-slate-300 px-3 py-2"
        />
      </div>

      <SubmitButton label="Se connecter" />
    </form>
  )
}
