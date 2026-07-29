'use client'

import { useRef, type KeyboardEvent, type PointerEvent } from 'react'
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
 * Les colonnes représentent indifféremment des coiffeurs (vue jour) ou des
 * jours (vue semaine d'un coiffeur) : chaque colonne peut porter sa propre
 * échelle temporelle.
 *
 * **La grille ne déplace rien.** Un clic ouvre le rendez-vous ; horaire, durée
 * et coiffeur se modifient dans sa fenêtre. Le glisser-déposer confondait deux
 * gestes très proches — cliquer pour consulter, tirer pour déplacer — et
 * décaler un rendez-vous par mégarde coûte cher à un salon. L'écrire ainsi rend
 * en outre la souris et le clavier strictement équivalents.
 *
 * La géométrie est calculée par `layout.ts`, testé sans navigateur.
 */

export type CalendarResource = {
  id: string
  label: string
  color: string
  /**
   * Échelle propre à la colonne. Nécessaire en vue semaine, où chaque colonne
   * couvre un jour différent. Absente, l'échelle globale s'applique.
   */
  scale?: GridScale
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
  /** Plage affichée, par défaut pour toutes les colonnes. */
  scale: GridScale
  timezone: string
  /** Granularité des créations, en minutes. */
  stepMinutes?: number
  onCreate?: (draft: { resourceId: string; startAt: number }) => void
  onSelect?: (id: string) => void
}

/**
 * Nuance par statut.
 *
 * La couleur de fond porte le coiffeur, jamais l'état : deux informations sur
 * un même canal seraient illisibles. Le statut passe par une pastille légendée
 * et un traitement du texte — la couleur seule ne doit jamais porter une
 * information (WCAG 1.4.1).
 */
const STATUS_STYLES: Record<string, string> = {
  DONE: 'opacity-75',
  NO_SHOW: 'opacity-70 line-through decoration-2',
  CANCELLED: 'opacity-50 line-through decoration-2',
}

const STATUS_BADGES: Record<string, { symbol: string; label: string }> = {
  CONFIRMED: { symbol: '●', label: 'confirmé' },
  PENDING: { symbol: '○', label: 'en attente' },
  DONE: { symbol: '✓', label: 'honoré' },
  NO_SHOW: { symbol: '✕', label: 'absent' },
  CANCELLED: { symbol: '⊘', label: 'annulé' },
}

/**
 * Fond très clair dérivé de la couleur du coiffeur.
 *
 * `color-mix` évite d'imposer un jeu de couleurs prédéfini : le salon choisit
 * une teinte libre, l'application en tire un fond lisible. Le mélange reste
 * faible pour que le texte ardoise garde son contraste quelle que soit la
 * couleur retenue — y compris un jaune vif.
 */
function tint(color: string, percent: number): string {
  return `color-mix(in srgb, ${color} ${percent}%, white)`
}

export function CalendarGrid({
  resources,
  events,
  scale,
  timezone,
  stepMinutes = 15,
  onCreate,
  onSelect,
}: CalendarGridProps) {
  const gridRef = useRef<HTMLDivElement>(null)

  const height = gridHeight(scale)
  const marks = hourMarks(scale)

  /**
   * Création par clic sur une plage libre.
   *
   * Le test `target === currentTarget` garantit qu'on a visé le fond et non un
   * rendez-vous : sans lui, ouvrir un bloc en créerait un autre derrière.
   */
  function handleColumnPointerUp(
    resource: CalendarResource,
    domEvent: PointerEvent<HTMLDivElement>,
  ) {
    if (domEvent.target !== domEvent.currentTarget || !onCreate) return

    const element = domEvent.currentTarget
    const offset = domEvent.clientY - element.getBoundingClientRect().top
    const startAt = offsetToInstant(offset, resource.scale ?? scale, stepMinutes)

    onCreate({ resourceId: resource.id, startAt })
  }

  /**
   * Parcours des rendez-vous au clavier (WCAG 2.1 AA).
   *
   * Les flèches passent d'un bloc à l'autre dans l'ordre du document, qui suit
   * les colonnes puis les heures. Elles ne déplacent plus rien : la grille ne
   * modifie pas, elle donne accès.
   */
  function handleEventKeyDown(domEvent: KeyboardEvent<HTMLButtonElement>) {
    const keys = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']
    if (!keys.includes(domEvent.key)) return

    const blocks = Array.from(
      gridRef.current?.querySelectorAll<HTMLButtonElement>('[data-rendez-vous]') ?? [],
    )
    const current = blocks.indexOf(domEvent.currentTarget)
    if (current === -1) return

    domEvent.preventDefault()
    const forward = domEvent.key === 'ArrowDown' || domEvent.key === 'ArrowRight'
    blocks[current + (forward ? 1 : -1)]?.focus()
  }

  const time = (instant: number) => formatInTimeZone(instant, timezone, 'HH:mm')

  return (
    <div className="overflow-x-auto" ref={gridRef}>
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
          const columnScale = resource.scale ?? scale
          const boxes = layoutEvents(
            events.filter((event) => event.resourceId === resource.id),
            columnScale,
          )

          return (
            <div key={resource.id} className="min-w-44 flex-1 border-l border-slate-200">
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
                className={cn('relative bg-slate-50/50', onCreate && 'cursor-copy')}
                style={{ height: gridHeight(columnScale) }}
                onPointerUp={(domEvent) => handleColumnPointerUp(resource, domEvent)}
              >
                {/* Lignes horaires */}
                {hourMarks(columnScale).map((mark) => (
                  <div
                    key={mark.instant}
                    aria-hidden="true"
                    className="pointer-events-none absolute inset-x-0 border-t border-slate-200"
                    style={{ top: mark.top }}
                  />
                ))}

                {boxes.map(({ event, top, height: blockHeight, left, width }) => {
                  const badge = event.status ? STATUS_BADGES[event.status] : undefined
                  // Sous cette hauteur, seul le titre tient : afficher l'horaire
                  // le tronquerait au point de le rendre illisible.
                  const compact = blockHeight < 44

                  return (
                    <button
                      key={event.id}
                      type="button"
                      data-rendez-vous
                      onClick={() => onSelect?.(event.id)}
                      onKeyDown={handleEventKeyDown}
                      aria-label={`${event.title}, de ${time(event.startAt)} à ${time(
                        event.endAt,
                      )}${badge ? `, ${badge.label}` : ''}`}
                      className={cn(
                        'absolute overflow-hidden rounded-md border border-l-4 px-2 py-1 text-left text-xs',
                        'transition-shadow hover:z-10 hover:shadow-md focus-visible:z-10',
                        event.status ? STATUS_STYLES[event.status] : undefined,
                      )}
                      style={{
                        top,
                        height: blockHeight,
                        left: `calc(${left * 100}% + 2px)`,
                        width: `calc(${width * 100}% - 4px)`,
                        backgroundColor: tint(resource.color, 14),
                        borderColor: tint(resource.color, 35),
                        borderLeftColor: resource.color,
                      }}
                    >
                      <span className="flex items-baseline gap-1.5">
                        <span className="block flex-1 truncate font-medium text-slate-900">
                          {event.title}
                        </span>
                        {badge && (
                          <span
                            aria-hidden="true"
                            className="shrink-0 text-[0.7rem] text-slate-600"
                          >
                            {badge.symbol}
                          </span>
                        )}
                      </span>

                      {!compact && (
                        <span className="block truncate text-slate-700">
                          {time(event.startAt)} – {time(event.endAt)}
                        </span>
                      )}

                      {!compact && event.subtitle && (
                        <span className="block truncate text-slate-600">
                          {event.subtitle}
                        </span>
                      )}
                    </button>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>

      <p className="mt-4 text-xs text-slate-500">
        Cliquez sur un rendez-vous pour l’ouvrir, ou sur une plage vide pour en créer un.
        Au clavier : Tab pour atteindre l’agenda, flèches pour passer d’un rendez-vous à
        l’autre, Entrée pour ouvrir.
      </p>
    </div>
  )
}
