'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { saveProfileAction } from './actions'

/**
 * Coordonnées du titulaire du compte.
 *
 * Le téléphone commande l'accès aux SMS : c'est la raison d'être de cet écran,
 * et le message d'aide le dit plutôt que de laisser deviner.
 */

type Props = {
  email: string
  firstName: string | null
  lastName: string | null
  phone: string | null
}

export function ProfileForm({ email, firstName, lastName, phone }: Props) {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [pending, startTransition] = useTransition()

  return (
    <form
      action={(formData) => {
        setError(null)
        setSaved(false)
        startTransition(async () => {
          const result = await saveProfileAction({
            firstName: String(formData.get('firstName') ?? ''),
            lastName: String(formData.get('lastName') ?? ''),
            phone: String(formData.get('phone') ?? ''),
          })
          if (!result.ok) {
            setError(result.error)
            return
          }
          setSaved(true)
          router.refresh()
        })
      }}
    >
      {error && (
        <p
          role="alert"
          className="mb-4 rounded-md bg-red-50 px-4 py-3 text-sm text-red-800"
        >
          {error}
        </p>
      )}
      {saved && (
        <p
          role="status"
          className="mb-4 rounded-md bg-emerald-50 px-4 py-3 text-sm text-emerald-800"
        >
          Profil enregistré.
        </p>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="firstName" className="text-sm font-medium">
            Prénom
          </label>
          <input
            id="firstName"
            name="firstName"
            required
            maxLength={80}
            defaultValue={firstName ?? ''}
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
            required
            maxLength={80}
            defaultValue={lastName ?? ''}
            className="rounded-md border border-slate-300 px-3 py-2"
          />
        </div>
      </div>

      <div className="mt-4 flex flex-col gap-1.5">
        <label htmlFor="phone" className="text-sm font-medium">
          Téléphone <span className="text-slate-500">(facultatif)</span>
        </label>
        <input
          id="phone"
          name="phone"
          type="tel"
          autoComplete="tel"
          inputMode="tel"
          defaultValue={phone ?? ''}
          aria-describedby="aide-telephone"
          className="max-w-xs rounded-md border border-slate-300 px-3 py-2"
        />
        <p id="aide-telephone" className="text-xs text-slate-500">
          Nécessaire pour recevoir les rappels par SMS. Le salon peut aussi vous joindre
          en cas d’imprévu. Format attendu : 06 12 34 56 78.
        </p>
      </div>

      <div className="mt-6 flex flex-col gap-1.5">
        <span className="text-sm font-medium">Adresse électronique</span>
        <p className="text-sm text-slate-600">{email}</p>
        <p className="text-xs text-slate-500">
          Elle identifie votre compte et ne peut pas être modifiée ici.
        </p>
      </div>

      <button
        type="submit"
        disabled={pending}
        className="bg-brand-600 hover:bg-brand-700 mt-6 rounded-md px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
      >
        {pending ? 'Enregistrement…' : 'Enregistrer'}
      </button>
    </form>
  )
}
