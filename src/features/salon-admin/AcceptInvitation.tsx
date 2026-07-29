'use client'

import { useState, useTransition } from 'react'
import { acceptInvitationAction } from './invitationActions'

/** Bouton d'acceptation d'une invitation d'équipe. */
export function AcceptInvitation({ token }: { token: string }) {
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function accept() {
    setError(null)
    startTransition(async () => {
      // En cas de succès, l'action redirige : rien ne revient ici.
      const result = await acceptInvitationAction(token)
      if (result && !result.ok) {
        setError(result.error)
      }
    })
  }

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
      <button
        type="button"
        onClick={accept}
        disabled={pending}
        className="bg-brand-600 hover:bg-brand-700 rounded-md px-5 py-2.5 font-medium text-white disabled:opacity-60"
      >
        {pending ? 'Acceptation…' : 'Accepter l’invitation'}
      </button>
    </div>
  )
}
