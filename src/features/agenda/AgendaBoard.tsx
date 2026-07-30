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
  setStaffNoteAction,
  setStatusAction,
} from './actions'
import { AppointmentDialog } from './AppointmentDialog'
import { StaffFilter } from './StaffFilter'
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
  /**
   * Coiffeur qui réalise la prestation.
   *
   * Distinct de `resourceId` : en vue semaine, la colonne est un jour. C'est
   * lui qui alimente le champ « Coiffeur » de la fenêtre et le déplacement
   * d'une personne à l'autre.
   */
  memberId: string
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
  /** Équipe du salon : nomme les coiffeurs et alimente le filtre. */
  staff: { id: string; label: string; color: string }[]
  /** Coiffeurs affichés. Vide vaut « toute l'équipe ». */
  selectedIds: string[]
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
  selectedIds,
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
  const key = `${date}|${view}|${selectedIds.join(',')}`
  const [signature, setSignature] = useState(key)
  const nextSignature = key
  if (signature !== nextSignature) {
    setSignature(nextSignature)
    setLocal(events)
    setSelectedId(null)
    setDraft(null)
  }

  const selected = local.find((event) => event.id === selectedId) ?? null
  const step = view === 'week' ? 7 : 1

  function navigate(next: { date?: string; view?: AgendaView; members?: string[] }) {
    const params = new URLSearchParams({
      date: next.date ?? date,
      view: next.view ?? view,
    })

    // Une sélection vide n'est pas écrite dans l'URL : elle vaut « toute
    // l'équipe », et un paramètre vide brouillerait le lien partagé.
    const members = next.members ?? selectedIds
    if (members.length > 0) {
      params.set('membres', members.join(','))
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
                memberId: next.memberId ?? event.memberId,
                // En vue jour la colonne est le coiffeur ; en vue semaine c'est
                // un jour, que seul un changement de date ferait bouger.
                resourceId:
                  view === 'day' ? (next.memberId ?? event.resourceId) : event.resourceId,
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

  /** Enregistre une note interne, sans fermer la fenêtre. */
  function saveNote(id: string, staffNote: string) {
    optimistic(
      (current) =>
        current.map((event) => (event.id === id ? { ...event, staffNote } : event)),
      () => setStaffNoteAction({ salonId, appointmentId: id, staffNote }),
    )
  }

  function openDraft(next: { resourceId: string; startAt: number }) {
    const shown = selectedIds.length > 0 ? selectedIds : staff.map((member) => member.id)

    // En vue semaine, la colonne est un jour : le coiffeur ne s'en déduit pas.
    // On ne peut le désigner sans ambiguïté que si un seul est affiché.
    const targetMember =
      view === 'week' ? (shown.length === 1 ? shown[0] : null) : next.resourceId

    if (!targetMember) {
      setError(
        'Choisissez un seul coiffeur pour créer un rendez-vous depuis la vue semaine.',
      )
      return
    }

    setDraft({
      resourceId: targetMember,
      startAt: next.startAt,
      memberLabel: staff.find((s) => s.id === targetMember)?.label ?? 'Coiffeur',
    })
  }

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 sm:gap-4">
        <nav
          aria-label="Navigation dans l’agenda"
          className="flex flex-1 items-center justify-between gap-2 sm:flex-none sm:justify-start sm:gap-3"
        >
          <button
            type="button"
            onClick={() => navigate({ date: shiftDate(date, -step) })}
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm"
          >
            <span aria-hidden="true">←</span>
            <span className="hidden sm:inline">
              {' '}
              {view === 'week' ? 'Semaine précédente' : 'Jour précédent'}
            </span>
            <span className="sr-only">
              {view === 'week' ? 'Semaine précédente' : 'Jour précédent'}
            </span>
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
            <span className="sm:hidden" aria-hidden="true">
              →
            </span>
            <span className="hidden sm:inline">
              <span className="hidden sm:inline">
                {view === 'week' ? 'Semaine suivante' : 'Jour suivant'}{' '}
              </span>
              <span className="sr-only">
                {view === 'week' ? 'Semaine suivante' : 'Jour suivant'}
              </span>
              <span aria-hidden="true">→</span>
            </span>
          </button>
        </nav>

        <div className="flex items-center gap-3">
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
              onClick={() => navigate({ view: 'week' })}
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

      {staff.length > 1 && (
        <div className="mt-4">
          <StaffFilter
            staff={staff}
            selected={selectedIds}
            onChange={(next) => navigate({ members: next })}
          />
        </div>
      )}

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
          salonId={salonId}
          timezone={timezone}
          staff={staff}
          canWrite={canWrite}
          pending={pending}
          onClose={() => setSelectedId(null)}
          onReschedule={(next) => reschedule(selected.id, next)}
          onStatus={(status) => changeStatus(selected.id, status)}
          onSaveNote={(note) => saveNote(selected.id, note)}
        />
      )}
    </div>
  )
}
