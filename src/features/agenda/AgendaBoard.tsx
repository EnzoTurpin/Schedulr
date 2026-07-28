'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { formatInTimeZone } from 'date-fns-tz'
import { CalendarGrid, type CalendarEvent } from '@/features/calendar/CalendarGrid'
import type { GridScale } from '@/features/calendar/layout'
import { formatPrice } from '@/lib/format'
import { cn } from '@/lib/utils'
import { moveAppointmentAction, setStatusAction } from './actions'

/**
 * Plan de travail de l'agenda : grille, panneau de détail, changement de jour.
 *
 * Applique une mise à jour optimiste **réversible** sur le déplacement : le
 * bloc suit le pointeur immédiatement, puis retourne à sa position d'origine si
 * le serveur refuse (ADR-0004). Sans ce retour, un gérant croirait son
 * déplacement effectué alors qu'il a été rejeté.
 */

export type AgendaEvent = CalendarEvent & {
  clientPhone: string | null
  staffNote: string | null
  clientNote: string | null
  services: string[]
  totalPriceCents: number
}

type Props = {
  salonId: string
  timezone: string
  date: string
  resources: { id: string; label: string; color: string }[]
  events: AgendaEvent[]
  scale: GridScale
  canWrite: boolean
}

const STATUS_LABELS: Record<string, string> = {
  PENDING: 'En attente',
  CONFIRMED: 'Confirmé',
  DONE: 'Honoré',
  NO_SHOW: 'Non honoré',
}

/** Décale une date `AAAA-MM-JJ` de `days` jours. */
function shiftDate(date: string, days: number): string {
  const noon = new Date(`${date}T12:00:00Z`)
  noon.setUTCDate(noon.getUTCDate() + days)
  return noon.toISOString().slice(0, 10)
}

export function AgendaBoard({
  salonId,
  timezone,
  date,
  resources,
  events,
  scale,
  canWrite,
}: Props) {
  const router = useRouter()
  const [local, setLocal] = useState(events)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [, startTransition] = useTransition()

  // Les évènements viennent du serveur : une navigation de jour doit primer
  // sur l'état optimiste conservé ici.
  const [lastDate, setLastDate] = useState(date)
  if (lastDate !== date) {
    setLastDate(date)
    setLocal(events)
    setSelectedId(null)
  }

  const selected = local.find((event) => event.id === selectedId) ?? null

  function move(id: string, next: { resourceId: string; startAt: number }) {
    const previous = local
    const target = local.find((event) => event.id === id)
    if (!target) return

    setError(null)
    // Mise à jour optimiste : le bloc bouge tout de suite.
    setLocal((current) =>
      current.map((event) =>
        event.id === id
          ? {
              ...event,
              resourceId: next.resourceId,
              startAt: next.startAt,
              endAt: next.startAt + (event.endAt - event.startAt),
            }
          : event,
      ),
    )

    startTransition(async () => {
      const result = await moveAppointmentAction({
        salonId,
        appointmentId: id,
        startAt: next.startAt,
        memberId: next.resourceId,
      })

      if (!result.ok) {
        // Retour à la position d'origine : sans cela, l'affichage mentirait.
        setLocal(previous)
        setError(result.error)
        return
      }
      router.refresh()
    })
  }

  function changeStatus(id: string, status: 'DONE' | 'NO_SHOW' | 'CANCELLED') {
    setError(null)
    startTransition(async () => {
      const result = await setStatusAction({ salonId, appointmentId: id, status })
      if (!result.ok) {
        setError(result.error)
        return
      }
      setSelectedId(null)
      router.refresh()
    })
  }

  return (
    <div>
      <nav aria-label="Navigation par jour" className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => router.push(`/pro/${salonId}?date=${shiftDate(date, -1)}`)}
          className="rounded-md border border-slate-300 px-3 py-1.5 text-sm"
        >
          ← Jour précédent
        </button>
        <p className="font-medium" aria-live="polite">
          {formatInTimeZone(new Date(`${date}T12:00:00Z`), timezone, 'EEEE d MMMM yyyy')}
        </p>
        <button
          type="button"
          onClick={() => router.push(`/pro/${salonId}?date=${shiftDate(date, 1)}`)}
          className="rounded-md border border-slate-300 px-3 py-1.5 text-sm"
        >
          Jour suivant →
        </button>
      </nav>

      {error && (
        <p
          role="alert"
          className="mt-4 rounded-md bg-red-50 px-4 py-3 text-sm text-red-800"
        >
          {error}
        </p>
      )}

      <div className="mt-6 rounded-lg border border-slate-200">
        <CalendarGrid
          resources={resources}
          events={local}
          scale={scale}
          timezone={timezone}
          onSelect={setSelectedId}
          onMove={canWrite ? move : undefined}
        />
      </div>

      {selected && (
        <aside
          aria-label="Détail du rendez-vous"
          className="mt-6 rounded-lg border border-slate-200 p-5"
        >
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="text-lg font-semibold">{selected.title}</h2>
            <span className="rounded bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
              {STATUS_LABELS[selected.status ?? ''] ?? selected.status}
            </span>
          </div>

          <dl className="mt-4 grid grid-cols-[8rem_1fr] gap-y-2 text-sm">
            <dt className="text-slate-500">Horaire</dt>
            <dd>
              {formatInTimeZone(selected.startAt, timezone, 'HH:mm')} –{' '}
              {formatInTimeZone(selected.endAt, timezone, 'HH:mm')}
            </dd>
            <dt className="text-slate-500">Prestations</dt>
            <dd>{selected.services.join(', ')}</dd>
            <dt className="text-slate-500">Total</dt>
            <dd>{formatPrice(selected.totalPriceCents)}</dd>
            {selected.clientPhone && (
              <>
                <dt className="text-slate-500">Téléphone</dt>
                <dd>{selected.clientPhone}</dd>
              </>
            )}
            {selected.clientNote && (
              <>
                <dt className="text-slate-500">Message client</dt>
                <dd>{selected.clientNote}</dd>
              </>
            )}
            {selected.staffNote && (
              <>
                <dt className="text-slate-500">Note interne</dt>
                <dd>{selected.staffNote}</dd>
              </>
            )}
          </dl>

          {canWrite && selected.status !== 'DONE' && selected.status !== 'NO_SHOW' && (
            <div className="mt-5 flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => changeStatus(selected.id, 'DONE')}
                className="rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700"
              >
                Marquer honoré
              </button>
              <button
                type="button"
                onClick={() => changeStatus(selected.id, 'NO_SHOW')}
                className="rounded-md border border-amber-500 px-3 py-1.5 text-sm font-medium text-amber-700"
              >
                Client absent
              </button>
              <button
                type="button"
                onClick={() => changeStatus(selected.id, 'CANCELLED')}
                className="rounded-md border border-red-400 px-3 py-1.5 text-sm font-medium text-red-700"
              >
                Annuler
              </button>
            </div>
          )}

          <button
            type="button"
            onClick={() => setSelectedId(null)}
            className={cn('mt-5 text-sm text-slate-600 underline')}
          >
            Fermer le détail
          </button>
        </aside>
      )}
    </div>
  )
}
