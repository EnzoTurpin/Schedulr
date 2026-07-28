'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { formatInTimeZone } from 'date-fns-tz'
import {
  CalendarGrid,
  type CalendarEvent,
  type CalendarResource,
} from '@/features/calendar/CalendarGrid'
import type { GridScale } from '@/features/calendar/layout'
import { formatDate, formatPrice } from '@/lib/format'
import { cn } from '@/lib/utils'
import {
  moveAppointmentAction,
  resizeAppointmentAction,
  setStatusAction,
} from './actions'
import { WalkInDialog, type WalkInDraft } from './WalkInDialog'

/**
 * Plan de travail de l'agenda : grille, panneau de détail, navigation.
 *
 * Applique une mise à jour optimiste **réversible** sur le déplacement et le
 * redimensionnement : le bloc suit le geste immédiatement, puis retourne à son
 * état d'origine si le serveur refuse (ADR-0004). Sans ce retour, un gérant
 * croirait son changement effectué alors qu'il a été rejeté.
 */

export type AgendaEvent = CalendarEvent & {
  clientPhone: string | null
  staffNote: string | null
  clientNote: string | null
  services: string[]
  totalPriceCents: number
}

export type AgendaView = 'day' | 'week'

type Props = {
  salonId: string
  timezone: string
  date: string
  view: AgendaView
  /** Colonnes : coiffeurs en vue jour, jours en vue semaine. */
  resources: CalendarResource[]
  /** Équipe du salon, pour nommer le coiffeur dans le formulaire de création. */
  staff: { id: string; label: string }[]
  /** Coiffeur affiché en vue semaine. */
  memberId?: string
  events: AgendaEvent[]
  services: { id: string; name: string; durationMin: number; priceCents: number }[]
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
  view,
  resources,
  staff,
  memberId,
  events,
  services,
  scale,
  canWrite,
}: Props) {
  const router = useRouter()
  const [local, setLocal] = useState(events)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [draft, setDraft] = useState<WalkInDraft | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [, startTransition] = useTransition()

  // Les évènements viennent du serveur : une navigation doit primer sur l'état
  // optimiste conservé ici.
  const [signature, setSignature] = useState(`${date}|${view}|${memberId ?? ''}`)
  const nextSignature = `${date}|${view}|${memberId ?? ''}`
  if (signature !== nextSignature) {
    setSignature(nextSignature)
    setLocal(events)
    setSelectedId(null)
    setDraft(null)
  }

  const selected = local.find((event) => event.id === selectedId) ?? null
  const step = view === 'week' ? 7 : 1

  function navigate(next: { date?: string; view?: AgendaView; member?: string }) {
    const params = new URLSearchParams({
      date: next.date ?? date,
      view: next.view ?? view,
    })
    const member = next.member ?? memberId
    if ((next.view ?? view) === 'week' && member) {
      params.set('membre', member)
    }
    router.push(`/pro/${salonId}?${params}`)
  }

  /** Applique un changement optimiste, avec retour arrière si le serveur refuse. */
  function optimistic(
    apply: (current: AgendaEvent[]) => AgendaEvent[],
    call: () => Promise<{ ok: boolean; error?: string }>,
  ) {
    const previous = local
    setError(null)
    setLocal(apply)

    startTransition(async () => {
      const result = await call()
      if (!result.ok) {
        setLocal(previous)
        setError(result.error ?? 'L’opération a échoué.')
        return
      }
      router.refresh()
    })
  }

  function move(id: string, next: { resourceId: string; startAt: number }) {
    const target = local.find((event) => event.id === id)
    if (!target) return

    // En vue semaine, les colonnes sont des jours : changer de colonne déplace
    // le rendez-vous d'un jour à l'autre, sans changer de coiffeur.
    const dayShift =
      view === 'week' && next.resourceId !== target.resourceId
        ? resources.findIndex((r) => r.id === next.resourceId) -
          resources.findIndex((r) => r.id === target.resourceId)
        : 0
    const startAt = next.startAt + dayShift * 24 * 3_600_000

    optimistic(
      (current) =>
        current.map((event) =>
          event.id === id
            ? {
                ...event,
                resourceId: next.resourceId,
                startAt,
                endAt: startAt + (event.endAt - event.startAt),
              }
            : event,
        ),
      () =>
        moveAppointmentAction({
          salonId,
          appointmentId: id,
          startAt,
          // Le coiffeur ne change que si les colonnes en représentent.
          ...(view === 'day' ? { memberId: next.resourceId } : {}),
        }),
    )
  }

  function resize(id: string, next: { endAt: number }) {
    optimistic(
      (current) =>
        current.map((event) =>
          event.id === id ? { ...event, endAt: next.endAt } : event,
        ),
      () => resizeAppointmentAction({ salonId, appointmentId: id, endAt: next.endAt }),
    )
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

  function openDraft(next: { resourceId: string; startAt: number }) {
    // En vue semaine, la colonne désigne un jour : le coiffeur est celui déjà
    // sélectionné.
    const targetMember = view === 'week' ? (memberId ?? staff[0]?.id) : next.resourceId
    if (!targetMember) return

    setDraft({
      resourceId: targetMember,
      startAt: next.startAt,
      memberLabel: staff.find((s) => s.id === targetMember)?.label ?? 'Coiffeur',
    })
  }

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <nav aria-label="Navigation dans l’agenda" className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => navigate({ date: shiftDate(date, -step) })}
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm"
          >
            ← {view === 'week' ? 'Semaine précédente' : 'Jour précédent'}
          </button>
          <p className="font-medium" aria-live="polite">
            {view === 'week'
              ? `Semaine du ${formatDate(new Date(`${date}T12:00:00Z`), timezone, 'd MMMM yyyy')}`
              : formatDate(new Date(`${date}T12:00:00Z`), timezone, 'EEEE d MMMM yyyy')}
          </p>
          <button
            type="button"
            onClick={() => navigate({ date: shiftDate(date, step) })}
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm"
          >
            {view === 'week' ? 'Semaine suivante' : 'Jour suivant'} →
          </button>
        </nav>

        <div className="flex items-center gap-3">
          {view === 'week' && (
            <>
              <label htmlFor="membre" className="text-sm">
                Coiffeur
              </label>
              <select
                id="membre"
                value={memberId ?? staff[0]?.id}
                onChange={(domEvent) => navigate({ member: domEvent.target.value })}
                className="rounded-md border border-slate-300 px-3 py-1.5 text-sm"
              >
                {staff.map((member) => (
                  <option key={member.id} value={member.id}>
                    {member.label}
                  </option>
                ))}
              </select>
            </>
          )}

          <div
            className="flex rounded-md border border-slate-300"
            role="group"
            aria-label="Vue"
          >
            <button
              type="button"
              onClick={() => navigate({ view: 'day' })}
              aria-pressed={view === 'day'}
              className={cn(
                'rounded-l-md px-3 py-1.5 text-sm',
                view === 'day' && 'bg-brand-600 font-medium text-white',
              )}
            >
              Jour
            </button>
            <button
              type="button"
              onClick={() => navigate({ view: 'week', member: memberId ?? staff[0]?.id })}
              aria-pressed={view === 'week'}
              className={cn(
                'rounded-r-md px-3 py-1.5 text-sm',
                view === 'week' && 'bg-brand-600 font-medium text-white',
              )}
            >
              Semaine
            </button>
          </div>
        </div>
      </div>

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
          onResize={canWrite ? resize : undefined}
          onCreate={canWrite ? openDraft : undefined}
        />
      </div>

      {draft && (
        <WalkInDialog
          salonId={salonId}
          timezone={timezone}
          draft={draft}
          services={services}
          onClose={() => setDraft(null)}
          onCreated={() => {
            setDraft(null)
            router.refresh()
          }}
        />
      )}

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
            className="mt-5 text-sm text-slate-600 underline"
          >
            Fermer le détail
          </button>
        </aside>
      )}
    </div>
  )
}
