'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { cancelAppointment } from './actions'

/**
 * Annulation d'un rendez-vous par le client.
 *
 * Confirmation explicite avant l'appel : l'annulation est irréversible et
 * libère le créneau immédiatement.
 */
export function CancelButton({ appointmentId }: { appointmentId: string }) {
  const router = useRouter()
  const [confirming, setConfirming] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function cancel() {
    setError(null)
    startTransition(async () => {
      const result = await cancelAppointment(appointmentId)
      if (result.ok) {
        setConfirming(false)
        router.refresh()
      } else {
        setError(result.error)
      }
    })
  }

  if (!confirming) {
    return (
      <div>
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className="text-sm text-slate-600 underline hover:text-slate-900"
        >
          Annuler ce rendez-vous
        </button>
        {error && (
          <p role="alert" className="mt-2 text-sm text-red-800">
            {error}
          </p>
        )}
      </div>
    )
  }

  return (
    <div className="rounded-md bg-slate-50 p-3">
      <p className="text-sm">Confirmer l’annulation de ce rendez-vous ?</p>
      {error && (
        <p role="alert" className="mt-2 text-sm text-red-800">
          {error}
        </p>
      )}
      <div className="mt-3 flex gap-3">
        <button
          type="button"
          onClick={cancel}
          disabled={pending}
          className="rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-60"
        >
          {pending ? 'Annulation…' : 'Oui, annuler'}
        </button>
        <button
          type="button"
          onClick={() => setConfirming(false)}
          disabled={pending}
          className="rounded-md border border-slate-300 px-3 py-1.5 text-sm"
        >
          Non, conserver
        </button>
      </div>
    </div>
  )
}
