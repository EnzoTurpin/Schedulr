'use client'

import { useEffect, useRef, useState } from 'react'
import { formatInTimeZone } from 'date-fns-tz'
import { formatDate, formatDuration, formatPrice } from '@/lib/format'
import type { AgendaEvent } from './AgendaBoard'

/**
 * Fenêtre d'un rendez-vous.
 *
 * Elle a remplacé le glisser-déposer : l'horaire, la durée et le coiffeur s'y
 * modifient par des champs explicites. Un déplacement devient un acte
 * délibéré, confirmé par un bouton, là où un glissement pouvait décaler un
 * rendez-vous d'un simple tremblement de souris.
 */

const STATUS_LABELS: Record<string, string> = {
  PENDING: 'En attente',
  CONFIRMED: 'Confirmé',
  DONE: 'Honoré',
  NO_SHOW: 'Client absent',
  CANCELLED: 'Annulé',
}

const STATUS_TONES: Record<string, string> = {
  PENDING: 'bg-slate-100 text-slate-700',
  CONFIRMED: 'bg-blue-100 text-blue-900',
  DONE: 'bg-emerald-100 text-emerald-900',
  NO_SHOW: 'bg-amber-100 text-amber-900',
  CANCELLED: 'bg-red-100 text-red-900',
}

/** Durées proposées. Au-delà, il vaut mieux ajouter une prestation. */
const DURATIONS = [15, 30, 45, 60, 75, 90, 120, 150, 180]

type Props = {
  event: AgendaEvent
  timezone: string
  /** Coiffeurs entre lesquels le rendez-vous peut être déplacé. */
  staff: { id: string; label: string }[]
  canWrite: boolean
  pending: boolean
  onClose: () => void
  onReschedule: (next: { startAt: number; endAt: number; memberId?: string }) => void
  onStatus: (status: 'DONE' | 'NO_SHOW' | 'CANCELLED') => void
}

/** `AAAA-MM-JJTHH:MM` dans le fuseau du salon, pour un champ `datetime-local`. */
function toLocalInput(instant: number, timezone: string): string {
  return formatInTimeZone(instant, timezone, "yyyy-MM-dd'T'HH:mm")
}

export function AppointmentDialog({
  event,
  timezone,
  staff,
  canWrite,
  pending,
  onClose,
  onReschedule,
  onStatus,
}: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null)

  // `showModal()` fournit le piège de focus, la fermeture par Échap et
  // l'inertie de l'arrière-plan — trois exigences d'accessibilité qu'une
  // simple `div` ne donnerait pas.
  useEffect(() => {
    dialogRef.current?.showModal()
  }, [])

  const durationMin = Math.round((event.endAt - event.startAt) / 60_000)

  const [start, setStart] = useState(() => toLocalInput(event.startAt, timezone))
  const [duration, setDuration] = useState(durationMin)
  const [member, setMember] = useState(event.memberId)
  const [editing, setEditing] = useState(false)

  const closed = event.status === 'DONE' || event.status === 'NO_SHOW'
  const cancelled = event.status === 'CANCELLED'

  /**
   * Les durées proposées incluent celle en cours, même hors liste : une durée
   * de 105 minutes saisie ailleurs ne doit pas disparaître du sélecteur.
   */
  const durations = DURATIONS.includes(durationMin)
    ? DURATIONS
    : [...DURATIONS, durationMin].sort((a, b) => a - b)

  function submit() {
    // `datetime-local` rend une heure locale sans fuseau. On la relit dans le
    // fuseau du salon, faute de quoi un gérant à l'étranger décalerait tous
    // ses rendez-vous.
    const [date, time] = start.split('T')
    const offset = formatInTimeZone(event.startAt, timezone, 'xxx')
    const startAt = new Date(`${date}T${time}:00${offset}`).getTime()

    onReschedule({
      startAt,
      endAt: startAt + duration * 60_000,
      ...(member !== event.memberId ? { memberId: member } : {}),
    })
  }

  return (
    <dialog
      ref={dialogRef}
      onClose={onClose}
      aria-labelledby="titre-rendez-vous"
      className="w-[min(34rem,calc(100vw-2rem))] rounded-lg p-0 backdrop:bg-slate-900/40"
    >
      <div className="p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 id="titre-rendez-vous" className="text-lg font-semibold">
              {event.title}
            </h2>
            <p className="mt-1 text-sm text-slate-600">
              {formatDate(event.startAt, timezone, 'EEEE d MMMM')} ·{' '}
              {formatInTimeZone(event.startAt, timezone, 'HH:mm')} –{' '}
              {formatInTimeZone(event.endAt, timezone, 'HH:mm')}
            </p>
          </div>
          <span
            className={`shrink-0 rounded px-2 py-0.5 text-xs font-medium ${
              STATUS_TONES[event.status ?? ''] ?? 'bg-slate-100 text-slate-700'
            }`}
          >
            {STATUS_LABELS[event.status ?? ''] ?? event.status}
          </span>
        </div>

        <dl className="mt-5 grid grid-cols-[7rem_1fr] gap-y-2.5 text-sm">
          <dt className="text-slate-500">Durée</dt>
          <dd>{formatDuration(durationMin)}</dd>

          <dt className="text-slate-500">Prestations</dt>
          <dd>{event.services.join(', ')}</dd>

          <dt className="text-slate-500">Total</dt>
          <dd className="font-medium">{formatPrice(event.totalPriceCents)}</dd>

          <dt className="text-slate-500">Coiffeur</dt>
          <dd>
            {staff.find((person) => person.id === event.memberId)?.label ??
              'Non attribué'}
          </dd>

          {event.clientPhone && (
            <>
              <dt className="text-slate-500">Téléphone</dt>
              <dd>
                <a href={`tel:${event.clientPhone}`} className="underline">
                  {event.clientPhone}
                </a>
              </dd>
            </>
          )}

          {event.clientNote && (
            <>
              <dt className="text-slate-500">Message client</dt>
              <dd>{event.clientNote}</dd>
            </>
          )}

          {event.staffNote && (
            <>
              <dt className="text-slate-500">Note interne</dt>
              <dd>{event.staffNote}</dd>
            </>
          )}
        </dl>

        {canWrite && !closed && !cancelled && (
          <div className="mt-6 border-t border-slate-200 pt-5">
            {editing ? (
              <>
                <h3 className="text-sm font-medium">Déplacer ce rendez-vous</h3>

                <div className="mt-3 grid gap-4 sm:grid-cols-2">
                  <div className="flex flex-col gap-1.5">
                    <label htmlFor="rdv-debut" className="text-sm">
                      Début
                    </label>
                    <input
                      id="rdv-debut"
                      type="datetime-local"
                      value={start}
                      onChange={(domEvent) => setStart(domEvent.target.value)}
                      className="rounded-md border border-slate-300 px-3 py-2 text-sm"
                    />
                  </div>

                  <div className="flex flex-col gap-1.5">
                    <label htmlFor="rdv-duree" className="text-sm">
                      Durée
                    </label>
                    <select
                      id="rdv-duree"
                      value={duration}
                      onChange={(domEvent) => setDuration(Number(domEvent.target.value))}
                      className="rounded-md border border-slate-300 px-3 py-2 text-sm"
                    >
                      {durations.map((minutes) => (
                        <option key={minutes} value={minutes}>
                          {formatDuration(minutes)}
                        </option>
                      ))}
                    </select>
                  </div>

                  {staff.length > 1 && (
                    <div className="flex flex-col gap-1.5 sm:col-span-2">
                      <label htmlFor="rdv-coiffeur" className="text-sm">
                        Coiffeur
                      </label>
                      <select
                        id="rdv-coiffeur"
                        value={member}
                        onChange={(domEvent) => setMember(domEvent.target.value)}
                        className="rounded-md border border-slate-300 px-3 py-2 text-sm"
                      >
                        {staff.map((person) => (
                          <option key={person.id} value={person.id}>
                            {person.label}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                </div>

                <div className="mt-4 flex flex-wrap gap-3">
                  <button
                    type="button"
                    disabled={pending}
                    onClick={submit}
                    className="bg-brand-600 hover:bg-brand-700 rounded-md px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
                  >
                    {pending ? 'Enregistrement…' : 'Enregistrer'}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setStart(toLocalInput(event.startAt, timezone))
                      setDuration(durationMin)
                      setMember(event.resourceId)
                      setEditing(false)
                    }}
                    className="rounded-md border border-slate-300 px-4 py-2 text-sm"
                  >
                    Annuler
                  </button>
                </div>
              </>
            ) : (
              <div className="flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={() => setEditing(true)}
                  className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium"
                >
                  Déplacer
                </button>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => onStatus('DONE')}
                  className="rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
                >
                  Marquer honoré
                </button>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => onStatus('NO_SHOW')}
                  className="rounded-md border border-amber-500 px-3 py-1.5 text-sm font-medium text-amber-700 disabled:opacity-50"
                >
                  Client absent
                </button>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => onStatus('CANCELLED')}
                  className="rounded-md border border-red-400 px-3 py-1.5 text-sm font-medium text-red-700 disabled:opacity-50"
                >
                  Annuler le rendez-vous
                </button>
              </div>
            )}
          </div>
        )}

        {(closed || cancelled) && (
          <p className="mt-6 border-t border-slate-200 pt-5 text-sm text-slate-600">
            Ce rendez-vous est clos : il ne peut plus être déplacé ni modifié.
          </p>
        )}

        <button
          type="button"
          onClick={() => dialogRef.current?.close()}
          className="mt-6 text-sm text-slate-600 underline"
        >
          Fermer
        </button>
      </div>
    </dialog>
  )
}
