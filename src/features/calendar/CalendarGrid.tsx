'use client'

import { useState, type KeyboardEvent, type PointerEvent } from 'react'
import { formatInTimeZone } from 'date-fns-tz'
import {
  gridHeight,
  hourMarks,
  layoutEvents,
  offsetToInstant,
  type GridScale,
} from './layout'
import { cn } from '@/lib/utils'

/**
 * Grille d'agenda multi-ressources (ADR-0005).
 *
 * Interface volontairement étroite : le composant reçoit des ressources et des
 * évènements, il émet des intentions. Aucun appel de données, aucune logique
 * métier, aucun accès à la session. C'est cette frontière qui rend la décision
 * réversible — basculer sur une bibliothèque tierce ne toucherait que ce
 * fichier.
 *
 * La géométrie est calculée par `layout.ts`, testé sans navigateur.
 */

export type CalendarResource = {
  id: string
  label: string
  color: string
}

export type CalendarEvent = {
  id: string
  resourceId: string
  startAt: number
  endAt: number
  title: string
  subtitle?: string
  /** Statut, pour la nuance visuelle et l'annonce vocale. */
  status?: string
}

export type CalendarGridProps = {
  resources: CalendarResource[]
  events: CalendarEvent[]
  /** Plage affichée. */
  scale: GridScale
  timezone: string
  /** Granularité des créations et des déplacements, en minutes. */
  stepMinutes?: number
  onCreate?: (draft: { resourceId: string; startAt: number }) => void
  onMove?: (id: string, next: { resourceId: string; startAt: number }) => void
  onSelect?: (id: string) => void
}

/** Nuances par statut. Le libellé porte toujours l'information, pas la couleur seule. */
const STATUS_STYLES: Record<string, string> = {
  DONE: 'opacity-70',
  NO_SHOW: 'opacity-60 line-through',
}

export function CalendarGrid({
  resources,
  events,
  scale,
  timezone,
  stepMinutes = 15,
  onCreate,
  onMove,
  onSelect,
}: CalendarGridProps) {
  const [dragging, setDragging] = useState<{ id: string; resourceId: string } | null>(
    null,
  )

  const height = gridHeight(scale)
  const marks = hourMarks(scale)

  /** Position verticale d'un évènement de pointeur, relative à la colonne. */
  function offsetIn(element: HTMLElement, clientY: number): number {
    return clientY - element.getBoundingClientRect().top
  }

  function handleColumnPointerDown(
    resourceId: string,
    domEvent: PointerEvent<HTMLDivElement>,
  ) {
    // Seul un clic sur le fond crée : un clic sur un bloc le sélectionne.
    if (domEvent.target !== domEvent.currentTarget || !onCreate) return

    const startAt = offsetToInstant(
      offsetIn(domEvent.currentTarget, domEvent.clientY),
      scale,
      stepMinutes,
    )
    onCreate({ resourceId, startAt })
  }

  function handleDrop(resourceId: string, domEvent: PointerEvent<HTMLDivElement>) {
    if (!dragging || !onMove) return

    const startAt = offsetToInstant(
      offsetIn(domEvent.currentTarget, domEvent.clientY),
      scale,
      stepMinutes,
    )
    onMove(dragging.id, { resourceId, startAt })
    setDragging(null)
  }

  /**
   * Navigation clavier (WCAG 2.1 AA).
   *
   * Tout ce qui se fait à la souris doit se faire au clavier : les flèches
   * déplacent d'un pas, Maj+flèches changent de coiffeur, Entrée ouvre le
   * détail.
   */
  function handleEventKeyDown(
    domEvent: KeyboardEvent<HTMLButtonElement>,
    event: CalendarEvent,
  ) {
    const stepMs = stepMinutes * 60_000
    const columnIndex = resources.findIndex((r) => r.id === event.resourceId)

    switch (domEvent.key) {
      case 'Enter':
      case ' ':
        domEvent.preventDefault()
        onSelect?.(event.id)
        return

      case 'ArrowUp':
      case 'ArrowDown': {
        if (!onMove) return
        domEvent.preventDefault()
        const delta = domEvent.key === 'ArrowUp' ? -stepMs : stepMs
        onMove(event.id, {
          resourceId: event.resourceId,
          startAt: event.startAt + delta,
        })
        return
      }

      case 'ArrowLeft':
      case 'ArrowRight': {
        if (!onMove || !domEvent.shiftKey) return
        domEvent.preventDefault()
        const next = columnIndex + (domEvent.key === 'ArrowLeft' ? -1 : 1)
        const target = resources[next]
        if (target) {
          onMove(event.id, { resourceId: target.id, startAt: event.startAt })
        }
        return
      }

      default:
        return
    }
  }

  const time = (instant: number) => formatInTimeZone(instant, timezone, 'HH:mm')

  return (
    <div className="overflow-x-auto">
      <div className="flex min-w-max">
        {/* Colonne des heures */}
        <div className="w-16 shrink-0" aria-hidden="true">
          <div className="h-10 border-b border-slate-200" />
          <div className="relative" style={{ height }}>
            {marks.map((mark) => (
              <span
                key={mark.instant}
                className="absolute -translate-y-1/2 pr-2 text-right text-xs text-slate-500"
                style={{ top: mark.top, right: 0 }}
              >
                {time(mark.instant)}
              </span>
            ))}
          </div>
        </div>

        {resources.map((resource) => {
          const boxes = layoutEvents(
            events.filter((event) => event.resourceId === resource.id),
            scale,
          )

          return (
            <div key={resource.id} className="min-w-40 flex-1 border-l border-slate-200">
              <h3
                className="flex h-10 items-center gap-2 border-b border-slate-200 px-3 text-sm font-medium"
                id={`colonne-${resource.id}`}
              >
                <span
                  aria-hidden="true"
                  className="size-2.5 shrink-0 rounded-full"
                  style={{ backgroundColor: resource.color }}
                />
                {resource.label}
              </h3>

              <div
                // Pas de `role="grid"` : le rôle ARIA « grid » impose des
                // enfants `row` et `gridcell`, que cette disposition n'a pas —
                // les rendez-vous sont positionnés en absolu, pas alignés en
                // lignes. `group` décrit correctement un ensemble de contrôles
                // apparentés, et chaque bloc reste un bouton accessible.
                role="group"
                aria-labelledby={`colonne-${resource.id}`}
                className="relative bg-slate-50/50"
                style={{ height }}
                onPointerDown={(domEvent) =>
                  handleColumnPointerDown(resource.id, domEvent)
                }
                onPointerUp={(domEvent) => handleDrop(resource.id, domEvent)}
              >
                {/* Lignes horaires */}
                {marks.map((mark) => (
                  <div
                    key={mark.instant}
                    aria-hidden="true"
                    className="pointer-events-none absolute inset-x-0 border-t border-slate-200"
                    style={{ top: mark.top }}
                  />
                ))}

                {boxes.map(({ event, top, height: blockHeight, left, width }) => (
                  <button
                    key={event.id}
                    type="button"
                    onClick={() => onSelect?.(event.id)}
                    onKeyDown={(domEvent) => handleEventKeyDown(domEvent, event)}
                    onPointerDown={() =>
                      setDragging({ id: event.id, resourceId: event.resourceId })
                    }
                    aria-label={`${event.title}, de ${time(event.startAt)} à ${time(event.endAt)}${
                      event.status ? `, ${event.status}` : ''
                    }`}
                    className={cn(
                      'absolute overflow-hidden rounded border-l-4 bg-white px-2 py-1 text-left text-xs shadow-sm',
                      'hover:z-10 hover:shadow-md focus-visible:z-10',
                      event.status ? STATUS_STYLES[event.status] : undefined,
                    )}
                    style={{
                      top,
                      height: blockHeight,
                      left: `calc(${left * 100}% + 2px)`,
                      width: `calc(${width * 100}% - 4px)`,
                      borderLeftColor: resource.color,
                    }}
                  >
                    <span className="block truncate font-medium">{event.title}</span>
                    <span className="block truncate text-slate-500">
                      {time(event.startAt)} – {time(event.endAt)}
                    </span>
                    {event.subtitle && (
                      <span className="block truncate text-slate-500">
                        {event.subtitle}
                      </span>
                    )}
                  </button>
                ))}
              </div>
            </div>
          )
        })}
      </div>

      <p className="mt-4 text-xs text-slate-500">
        Cliquez sur une plage vide pour créer un rendez-vous. Au clavier : flèches haut et
        bas pour déplacer, Maj + flèches gauche et droite pour changer de coiffeur, Entrée
        pour ouvrir le détail.
      </p>
    </div>
  )
}
