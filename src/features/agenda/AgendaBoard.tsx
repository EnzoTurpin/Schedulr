'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import {
  CalendarGrid,
  type CalendarEvent,
  type CalendarResource,
} from '@/features/calendar/CalendarGrid'
import type { GridScale } from '@/features/calendar/layout'
import { formatDate } from '@/lib/format'
import { cn } from '@/lib/utils'
import {
  moveAppointmentAction,
  resizeAppointmentAction,
  setStatusAction,
} from './actions'
import { AppointmentDialog } from './AppointmentDialog'
import { WalkInDialog, type WalkInDraft } from './WalkInDialog'

/**
 * Plan de travail de l'agenda : grille, fenêtre de rendez-vous, navigation.
 *
 * Applique une mise à jour optimiste **réversible** aux déplacements : le bloc
 * bouge immédiatement, puis retrouve sa place si le serveur refuse (ADR-0004).
 * Sans ce retour, un gérant croirait son changement effectué alors qu'il a été
 * rejeté par la contrainte anti-chevauchement.
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
  const [pending, startTransition] = useTransition()

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

  /**
   * Déplace un rendez-vous depuis sa fenêtre.
   *
   * L'horaire et la durée arrivent ensemble : les traiter en deux appels
   * laisserait un état intermédiaire susceptible d'être refusé par la
   * contrainte anti-chevauchement alors que le résultat final est valide.
   */
  function reschedule(
    id: string,
    next: { startAt: number; endAt: number; memberId?: string },
  ) {
    const target = local.find((event) => event.id === id)
    if (!target) return

    optimistic(
      (current) =>
        current.map((event) =>
          event.id === id
            ? {
                ...event,
                resourceId: next.memberId ?? event.resourceId,
                startAt: next.startAt,
                endAt: next.endAt,
              }
            : event,
        ),
      async () => {
        const moved = await moveAppointmentAction({
          salonId,
          appointmentId: id,
          startAt: next.startAt,
          ...(next.memberId ? { memberId: next.memberId } : {}),
        })
        if (!moved.ok) return moved

        // La durée n'a pas changé : inutile de solliciter le serveur une
        // seconde fois.
        if (next.endAt - next.startAt === target.endAt - target.startAt) return moved

        return resizeAppointmentAction({
          salonId,
          appointmentId: id,
          endAt: next.endAt,
        })
      },
    )
    setSelectedId(null)
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
        <AppointmentDialog
          event={selected}
          timezone={timezone}
          staff={staff}
          // En vue semaine, les colonnes sont des jours : le coiffeur est déjà
          // choisi et ne se change pas depuis cet écran.
          canChangeMember={view === 'day'}
          canWrite={canWrite}
          pending={pending}
          onClose={() => setSelectedId(null)}
          onReschedule={(next) => reschedule(selected.id, next)}
          onStatus={(status) => changeStatus(selected.id, status)}
        />
      )}
    </div>
  )
}
