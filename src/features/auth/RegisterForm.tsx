'use client'

import { useActionState } from 'react'
import { useFormStatus } from 'react-dom'
import { register, type ActionState } from './actions'
import { MIN_PASSWORD_LENGTH } from '@/lib/auth/constants'

const initialState: ActionState = { error: null }

function SubmitButton() {
  const { pending } = useFormStatus()
  return (
    <button
      type="submit"
      disabled={pending}
      className="bg-brand-600 hover:bg-brand-700 mt-2 rounded-md px-4 py-2.5 font-medium text-white disabled:opacity-60"
    >
      {pending ? 'Création…' : 'Créer mon compte'}
    </button>
  )
}

export function RegisterForm() {
  const [state, formAction] = useActionState(register, initialState)

  return (
    <form action={formAction} className="mt-8 flex flex-col gap-4">
      {state.error && (
        <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">
          {state.error}
        </p>
      )}

      <div className="grid grid-cols-2 gap-4">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="firstName" className="text-sm font-medium">
            Prénom
          </label>
          <input
            id="firstName"
            name="firstName"
            autoComplete="given-name"
            required
            className="rounded-md border border-slate-300 px-3 py-2"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="lastName" className="text-sm font-medium">
            Nom
          </label>
          <input
            id="lastName"
            name="lastName"
            autoComplete="family-name"
            required
            className="rounded-md border border-slate-300 px-3 py-2"
          />
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="phone" className="text-sm font-medium">
          Téléphone <span className="text-slate-500">(facultatif)</span>
        </label>
        <input
          id="phone"
          name="phone"
          type="tel"
          autoComplete="tel"
          inputMode="tel"
          aria-describedby="aide-telephone"
          className="rounded-md border border-slate-300 px-3 py-2"
        />
        <p id="aide-telephone" className="text-xs text-slate-500">
          Pour recevoir vos rappels par SMS. Modifiable à tout moment.
        </p>
      </div>

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
          autoComplete="new-password"
          required
          minLength={MIN_PASSWORD_LENGTH}
          aria-describedby="password-hint"
          className="rounded-md border border-slate-300 px-3 py-2"
        />
        <p id="password-hint" className="text-xs text-slate-500">
          {MIN_PASSWORD_LENGTH} caractères minimum.
        </p>
      </div>

      <SubmitButton />
    </form>
  )
}
