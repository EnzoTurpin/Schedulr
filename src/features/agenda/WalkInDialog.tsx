'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import { formatInTimeZone } from 'date-fns-tz'
import { formatDuration, formatPrice } from '@/lib/format'
import { createWalkInAction } from './actions'

/**
 * Création d'un rendez-vous pris au comptoir ou par téléphone.
 *
 * Ouvert par un clic sur une plage vide de l'agenda. Le client n'a pas de
 * compte : seul son nom est obligatoire, le téléphone reste facultatif — au
 * comptoir, on ne retient pas un client pour lui réclamer un numéro.
 */

export type WalkInDraft = {
  resourceId: string
  startAt: number
  memberLabel: string
}

type Service = { id: string; name: string; durationMin: number; priceCents: number }

type Props = {
  salonId: string
  timezone: string
  draft: WalkInDraft
  services: Service[]
  onClose: () => void
  onCreated: () => void
}

export function WalkInDialog({
  salonId,
  timezone,
  draft,
  services,
  onClose,
  onCreated,
}: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const [selected, setSelected] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  // `showModal()` fournit gratuitement le piège de focus, la fermeture par
  // Échap et l'inertie de l'arrière-plan — trois exigences d'accessibilité
  // qu'une div ne donnerait pas.
  useEffect(() => {
    dialogRef.current?.showModal()
  }, [])

  const chosen = services.filter((service) => selected.includes(service.id))
  const totalMin = chosen.reduce((sum, service) => sum + service.durationMin, 0)
  const totalCents = chosen.reduce((sum, service) => sum + service.priceCents, 0)

  function toggle(id: string) {
    setSelected((current) =>
      current.includes(id) ? current.filter((s) => s !== id) : [...current, id],
    )
  }

  function submit(formData: FormData) {
    setError(null)

    startTransition(async () => {
      const result = await createWalkInAction({
        salonId,
        memberId: draft.resourceId,
        serviceIds: selected,
        startAt: draft.startAt,
        guestName: String(formData.get('guestName') ?? '').trim(),
        guestPhone: String(formData.get('guestPhone') ?? '').trim() || undefined,
        source: String(formData.get('source') ?? 'SALON') as 'SALON' | 'PHONE',
        staffNote: String(formData.get('staffNote') ?? '').trim() || undefined,
      })

      if (result.ok) {
        onCreated()
        return
      }
      setError(result.error)
    })
  }

  return (
    <dialog
      ref={dialogRef}
      onClose={onClose}
      aria-labelledby="titre-walkin"
      className="w-full max-w-lg rounded-lg p-0 backdrop:bg-slate-900/40"
    >
      <form action={submit} className="p-6">
        <h2 id="titre-walkin" className="text-lg font-semibold">
          Nouveau rendez-vous
        </h2>
        <p className="mt-1 text-sm text-slate-600">
          {draft.memberLabel} · {formatInTimeZone(draft.startAt, timezone, 'HH:mm')}
        </p>

        {error && (
          <p
            role="alert"
            className="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-800"
          >
            {error}
          </p>
        )}

        <fieldset className="mt-5">
          <legend className="text-sm font-medium">Prestations</legend>
          <ul className="mt-2 max-h-48 overflow-y-auto rounded-md border border-slate-200">
            {services.map((service) => (
              <li key={service.id} className="border-b border-slate-100 last:border-0">
                <label className="flex cursor-pointer items-center gap-3 px-3 py-2 text-sm">
                  <input
                    type="checkbox"
                    checked={selected.includes(service.id)}
                    onChange={() => toggle(service.id)}
                    className="size-4"
                  />
                  <span className="flex-1">{service.name}</span>
                  <span className="text-slate-500">
                    {formatDuration(service.durationMin)}
                  </span>
                  <span className="w-16 text-right">
                    {formatPrice(service.priceCents)}
                  </span>
                </label>
              </li>
            ))}
          </ul>
          {chosen.length > 0 && (
            <p className="mt-2 text-sm text-slate-600" aria-live="polite">
              {formatDuration(totalMin)} · {formatPrice(totalCents)}
            </p>
          )}
        </fieldset>

        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="guestName" className="text-sm font-medium">
              Nom du client
            </label>
            <input
              id="guestName"
              name="guestName"
              required
              maxLength={120}
              className="rounded-md border border-slate-300 px-3 py-2"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="guestPhone" className="text-sm font-medium">
              Téléphone <span className="text-slate-500">(facultatif)</span>
            </label>
            <input
              id="guestPhone"
              name="guestPhone"
              type="tel"
              maxLength={30}
              className="rounded-md border border-slate-300 px-3 py-2"
            />
          </div>
        </div>

        <fieldset className="mt-5">
          <legend className="text-sm font-medium">Origine</legend>
          <div className="mt-2 flex gap-6">
            <label className="flex items-center gap-2 text-sm">
              <input type="radio" name="source" value="SALON" defaultChecked />
              Au comptoir
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="radio" name="source" value="PHONE" />
              Par téléphone
            </label>
          </div>
        </fieldset>

        <div className="mt-5 flex flex-col gap-1.5">
          <label htmlFor="staffNote" className="text-sm font-medium">
            Note interne <span className="text-slate-500">(non visible du client)</span>
          </label>
          <textarea
            id="staffNote"
            name="staffNote"
            rows={2}
            maxLength={1000}
            className="rounded-md border border-slate-300 px-3 py-2"
          />
        </div>

        <div className="mt-6 flex justify-end gap-3">
          <button
            type="button"
            onClick={() => dialogRef.current?.close()}
            className="rounded-md border border-slate-300 px-4 py-2 text-sm"
          >
            Annuler
          </button>
          <button
            type="submit"
            disabled={pending || selected.length === 0}
            className="bg-brand-600 hover:bg-brand-700 rounded-md px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {pending ? 'Création…' : 'Créer le rendez-vous'}
          </button>
        </div>
      </form>
    </dialog>
  )
}
