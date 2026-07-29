'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { WeekEditor, compactWeek, type Week } from './WeekEditor'
import {
  createClosureAction,
  deleteClosureAction,
  saveOpeningHoursAction,
} from './actions'

/**
 * Horaires d'ouverture et fermetures exceptionnelles.
 *
 * La semaine est éditée en bloc puis enregistrée d'un seul coup : un
 * enregistrement partiel laisserait des plages orphelines.
 */

type Closure = { id: string; startAt: Date; endAt: Date; reason: string | null }

type Props = {
  salonId: string
  timezone: string
  openingHours: Week
  closures: Closure[]
}

export function SchedulePanel({ salonId, timezone, openingHours, closures }: Props) {
  const router = useRouter()
  const [week, setWeek] = useState<Week>(openingHours)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [pending, startTransition] = useTransition()

  function save() {
    setError(null)
    startTransition(async () => {
      const result = await saveOpeningHoursAction({ salonId, week: compactWeek(week) })
      if (!result.ok) {
        setError(result.error)
        return
      }
      setSaved(true)
      router.refresh()
    })
  }

  function run(call: () => Promise<{ ok: boolean; error?: string }>) {
    setError(null)
    startTransition(async () => {
      const result = await call()
      if (!result.ok) {
        setError(result.error ?? 'L’enregistrement a échoué.')
        return
      }
      router.refresh()
    })
  }

  return (
    <section aria-labelledby="titre-horaires">
      <h2 id="titre-horaires" className="text-lg font-semibold">
        Horaires d’ouverture
      </h2>
      <p className="mt-1 text-sm text-slate-600">
        Heure locale du salon ({timezone}). Ajoutez deux plages pour une coupure déjeuner.
      </p>

      {error && (
        <p
          role="alert"
          className="mt-4 rounded-md bg-red-50 px-4 py-3 text-sm text-red-800"
        >
          {error}
        </p>
      )}
      {saved && (
        <p
          role="status"
          className="mt-4 rounded-md bg-emerald-50 px-4 py-3 text-sm text-emerald-800"
        >
          Horaires enregistrés.
        </p>
      )}

      <div className="mt-5">
        <WeekEditor
          week={week}
          onChange={(next) => {
            setSaved(false)
            setWeek(next)
          }}
          idPrefix="ouverture"
        />
      </div>

      <button
        type="button"
        onClick={save}
        disabled={pending}
        className="bg-brand-600 hover:bg-brand-700 mt-5 rounded-md px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
      >
        {pending ? 'Enregistrement…' : 'Enregistrer les horaires'}
      </button>

      <h2 className="mt-12 text-lg font-semibold">Fermetures exceptionnelles</h2>
      <p className="mt-1 text-sm text-slate-600">
        Congés annuels, jours fériés, travaux. Les créneaux concernés disparaissent de la
        réservation.
      </p>

      <form
        action={(formData) =>
          run(() =>
            createClosureAction({
              salonId,
              startAt: new Date(String(formData.get('start'))).getTime(),
              endAt: new Date(String(formData.get('end'))).getTime(),
              reason: String(formData.get('reason') ?? '') || undefined,
            }),
          )
        }
        className="mt-5 flex flex-wrap items-end gap-3"
      >
        <div className="flex flex-col gap-1.5">
          <label htmlFor="closure-start" className="text-sm font-medium">
            Du
          </label>
          <input
            id="closure-start"
            name="start"
            type="date"
            required
            className="rounded-md border border-slate-300 px-3 py-2"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="closure-end" className="text-sm font-medium">
            Au (exclu)
          </label>
          <input
            id="closure-end"
            name="end"
            type="date"
            required
            className="rounded-md border border-slate-300 px-3 py-2"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="closure-reason" className="text-sm font-medium">
            Motif
          </label>
          <input
            id="closure-reason"
            name="reason"
            maxLength={200}
            className="rounded-md border border-slate-300 px-3 py-2"
          />
        </div>
        <button
          type="submit"
          disabled={pending}
          className="rounded-md border border-slate-300 px-4 py-2 text-sm disabled:opacity-50"
        >
          Ajouter
        </button>
      </form>

      {closures.length > 0 ? (
        <ul className="mt-5 divide-y divide-slate-200">
          {closures.map((closure) => (
            <li
              key={closure.id}
              className="flex items-center justify-between py-3 text-sm"
            >
              <span>
                {new Intl.DateTimeFormat('fr-FR', { timeZone: timezone }).format(
                  closure.startAt,
                )}{' '}
                –{' '}
                {new Intl.DateTimeFormat('fr-FR', { timeZone: timezone }).format(
                  closure.endAt,
                )}
                {closure.reason && (
                  <span className="text-slate-500"> · {closure.reason}</span>
                )}
              </span>
              <button
                type="button"
                onClick={() =>
                  run(() => deleteClosureAction({ salonId, closureId: closure.id }))
                }
                className="text-slate-600 underline"
              >
                Supprimer
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-5 text-sm text-slate-600">Aucune fermeture programmée.</p>
      )}
    </section>
  )
}
