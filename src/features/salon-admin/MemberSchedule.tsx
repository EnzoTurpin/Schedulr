'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { WeekEditor, compactWeek, type Week } from './WeekEditor'
import {
  createTimeOffAction,
  deleteTimeOffAction,
  saveWorkingHoursAction,
} from './actions'

/**
 * Horaires de travail et congés d'un membre.
 *
 * Ces horaires ne sont pas un confort : le moteur de disponibilité croise les
 * heures d'ouverture du salon avec celles du membre, sans repli. Un membre sans
 * horaires ne se voit **jamais** proposer de créneau.
 */

export type TimeOff = {
  id: string
  memberId: string
  startAt: Date
  endAt: Date
  reason: string | null
}

type Props = {
  salonId: string
  memberId: string
  memberName: string
  timezone: string
  workingHours: Week
  timeOff: TimeOff[]
  /** Horaires d'ouverture du salon, proposés quand le membre n'en a aucun. */
  openingHours: Week
  onClose: () => void
}

export function MemberSchedule({
  salonId,
  memberId,
  memberName,
  timezone,
  workingHours,
  timeOff,
  openingHours,
  onClose,
}: Props) {
  const router = useRouter()
  const [week, setWeek] = useState<Week>(workingHours)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [pending, startTransition] = useTransition()

  const isEmpty = Object.values(week).every((ranges) => ranges.length === 0)

  function run(
    call: () => Promise<{ ok: boolean; error?: string }>,
    onDone?: () => void,
  ) {
    setError(null)
    startTransition(async () => {
      const result = await call()
      if (!result.ok) {
        setError(result.error ?? 'L’enregistrement a échoué.')
        return
      }
      onDone?.()
      router.refresh()
    })
  }

  return (
    <div className="mt-4 rounded-md bg-slate-50 p-4">
      <h4 className="font-medium">Horaires de {memberName}</h4>
      <p className="mt-1 text-xs text-slate-500">
        Heure locale du salon ({timezone}). Un membre ne travaille jamais hors des heures
        d’ouverture, même si ses plages sont plus larges.
      </p>

      {error && (
        <p
          role="alert"
          className="mt-3 rounded-md bg-red-50 px-4 py-3 text-sm text-red-800"
        >
          {error}
        </p>
      )}
      {saved && (
        <p
          role="status"
          className="mt-3 rounded-md bg-emerald-50 px-4 py-3 text-sm text-emerald-800"
        >
          Horaires enregistrés.
        </p>
      )}

      {isEmpty && (
        <div className="mt-3 rounded-md bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <p>Sans horaires, {memberName} n’apparaît sur aucun créneau de réservation.</p>
          <button
            type="button"
            onClick={() => {
              setSaved(false)
              setWeek(openingHours)
            }}
            className="mt-2 underline"
          >
            Reprendre les horaires d’ouverture du salon
          </button>
        </div>
      )}

      <div className="mt-3">
        <WeekEditor
          week={week}
          onChange={(next) => {
            setSaved(false)
            setWeek(next)
          }}
          idPrefix={`membre-${memberId}`}
        />
      </div>

      <div className="mt-4 flex gap-3">
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            run(
              () =>
                saveWorkingHoursAction({ salonId, memberId, week: compactWeek(week) }),
              () => setSaved(true),
            )
          }
          className="bg-brand-600 hover:bg-brand-700 rounded-md px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
        >
          {pending ? 'Enregistrement…' : 'Enregistrer les horaires'}
        </button>
        <button
          type="button"
          onClick={onClose}
          className="rounded-md border border-slate-300 px-3 py-1.5 text-sm"
        >
          Fermer
        </button>
      </div>

      <h4 className="mt-8 font-medium">Congés et absences</h4>
      <p className="mt-1 text-xs text-slate-500">
        Les créneaux concernés disparaissent de la réservation. Pour fermer le salon
        entier, utilisez plutôt les fermetures exceptionnelles.
      </p>

      <form
        action={(formData) =>
          run(() =>
            createTimeOffAction({
              salonId,
              memberId,
              startAt: new Date(String(formData.get('start'))).getTime(),
              endAt: new Date(String(formData.get('end'))).getTime(),
              reason: String(formData.get('reason') ?? '') || undefined,
            }),
          )
        }
        className="mt-3 flex flex-wrap items-end gap-3"
      >
        <div className="flex flex-col gap-1.5">
          <label htmlFor={`conge-debut-${memberId}`} className="text-sm font-medium">
            Du
          </label>
          <input
            id={`conge-debut-${memberId}`}
            name="start"
            type="date"
            required
            className="rounded-md border border-slate-300 px-3 py-2"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor={`conge-fin-${memberId}`} className="text-sm font-medium">
            Au (exclu)
          </label>
          <input
            id={`conge-fin-${memberId}`}
            name="end"
            type="date"
            required
            className="rounded-md border border-slate-300 px-3 py-2"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor={`conge-motif-${memberId}`} className="text-sm font-medium">
            Motif
          </label>
          <input
            id={`conge-motif-${memberId}`}
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

      {timeOff.length > 0 ? (
        <ul className="mt-4 divide-y divide-slate-200">
          {timeOff.map((absence) => (
            <li
              key={absence.id}
              className="flex items-center justify-between py-3 text-sm"
            >
              <span>
                {new Intl.DateTimeFormat('fr-FR', { timeZone: timezone }).format(
                  absence.startAt,
                )}{' '}
                –{' '}
                {new Intl.DateTimeFormat('fr-FR', { timeZone: timezone }).format(
                  absence.endAt,
                )}
                {absence.reason && (
                  <span className="text-slate-500"> · {absence.reason}</span>
                )}
              </span>
              <button
                type="button"
                onClick={() =>
                  run(() => deleteTimeOffAction({ salonId, timeOffId: absence.id }))
                }
                className="text-slate-600 underline"
              >
                Supprimer
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-4 text-sm text-slate-600">Aucune absence programmée.</p>
      )}
    </div>
  )
}
