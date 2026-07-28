/**
 * Géométrie de la grille d'agenda (ADR-0005).
 *
 * Fonctions pures : elles projettent des intervalles temporels sur des
 * coordonnées, sans toucher au DOM. C'est ce qui rend testable la partie
 * réellement délicate — la disposition des rendez-vous qui se chevauchent —
 * sans monter de navigateur.
 *
 * Le composant React ne fait qu'appliquer ces résultats en CSS.
 */

/** Un évènement à placer dans la grille. */
export type PositionedEvent = {
  id: string
  /** Instant de début, en millisecondes epoch. */
  startAt: number
  endAt: number
}

/** Position calculée, exprimée en pourcentages de la colonne. */
export type EventBox<T> = {
  event: T
  /** Distance depuis le haut de la grille, en pixels. */
  top: number
  /** Hauteur du bloc, en pixels. */
  height: number
  /** Décalage horizontal dans la colonne, de 0 à 1. */
  left: number
  /** Largeur relative dans la colonne, de 0 à 1. */
  width: number
}

export type GridScale = {
  /** Début de la plage affichée, en millisecondes epoch. */
  startAt: number
  /** Fin de la plage affichée. */
  endAt: number
  /** Hauteur d'une heure, en pixels. */
  hourHeight: number
}

const HOUR_MS = 60 * 60 * 1000

/** Hauteur totale de la grille, en pixels. */
export function gridHeight(scale: GridScale): number {
  return ((scale.endAt - scale.startAt) / HOUR_MS) * scale.hourHeight
}

/** Convertit un instant en distance verticale depuis le haut de la grille. */
export function instantToOffset(instant: number, scale: GridScale): number {
  return ((instant - scale.startAt) / HOUR_MS) * scale.hourHeight
}

/**
 * Convertit une distance verticale en instant, aligné sur un pas.
 *
 * Utilisé au clic et au glisser-déposer : un rendez-vous ne doit jamais être
 * créé à 14 h 03 parce que le pointeur était trois pixels plus bas.
 */
export function offsetToInstant(
  offset: number,
  scale: GridScale,
  stepMinutes: number,
): number {
  const raw = scale.startAt + (offset / scale.hourHeight) * HOUR_MS
  const stepMs = stepMinutes * 60_000
  const aligned = Math.round((raw - scale.startAt) / stepMs) * stepMs + scale.startAt

  // Bornes de la plage affichée : un glisser trop haut ou trop bas ne doit pas
  // produire un instant hors grille.
  return Math.min(Math.max(aligned, scale.startAt), scale.endAt)
}

/** Deux intervalles se chevauchent-ils ? Convention semi-ouverte, comme partout. */
function overlaps(a: PositionedEvent, b: PositionedEvent): boolean {
  return a.startAt < b.endAt && b.startAt < a.endAt
}

/**
 * Regroupe les évènements en grappes de chevauchement transitives.
 *
 * A chevauche B, B chevauche C mais pas A : les trois forment une seule grappe,
 * car ils doivent se partager la largeur de la colonne. Traiter les paires
 * indépendamment produirait des blocs superposés.
 */
function clusterize<T extends PositionedEvent>(events: readonly T[]): T[][] {
  const sorted = [...events].sort((a, b) => a.startAt - b.startAt || a.endAt - b.endAt)
  const clusters: T[][] = []

  let current: T[] = []
  let clusterEnd = -Infinity

  for (const event of sorted) {
    if (current.length > 0 && event.startAt < clusterEnd) {
      current.push(event)
      clusterEnd = Math.max(clusterEnd, event.endAt)
    } else {
      if (current.length > 0) clusters.push(current)
      current = [event]
      clusterEnd = event.endAt
    }
  }
  if (current.length > 0) clusters.push(current)

  return clusters
}

/**
 * Répartit une grappe en colonnes : chaque évènement rejoint la première
 * colonne où il n'entre en conflit avec aucun autre.
 */
function assignColumns<T extends PositionedEvent>(cluster: readonly T[]): T[][] {
  const columns: T[][] = []

  for (const event of cluster) {
    const target = columns.find(
      (column) => !column.some((existing) => overlaps(existing, event)),
    )
    if (target) {
      target.push(event)
    } else {
      columns.push([event])
    }
  }

  return columns
}

/**
 * Calcule la position de chaque évènement dans une colonne de coiffeur.
 *
 * Les évènements qui se chevauchent se partagent la largeur à parts égales.
 * C'est le cas de bord signalé dans l'ADR-0005 comme le plus susceptible de
 * poser problème — d'où sa couverture par des tests dédiés.
 */
export function layoutEvents<T extends PositionedEvent>(
  events: readonly T[],
  scale: GridScale,
): EventBox<T>[] {
  const boxes: EventBox<T>[] = []

  for (const cluster of clusterize(events)) {
    const columns = assignColumns(cluster)
    const width = 1 / columns.length

    columns.forEach((column, columnIndex) => {
      for (const event of column) {
        // Un rendez-vous commencé avant l'ouverture affichée est tronqué en
        // haut, plutôt que dessiné hors de la grille.
        const visibleStart = Math.max(event.startAt, scale.startAt)
        const visibleEnd = Math.min(event.endAt, scale.endAt)

        // Entièrement hors de la plage : rien à dessiner.
        if (visibleEnd <= visibleStart) continue

        boxes.push({
          event,
          top: instantToOffset(visibleStart, scale),
          height:
            instantToOffset(visibleEnd, scale) - instantToOffset(visibleStart, scale),
          left: columnIndex * width,
          width,
        })
      }
    })
  }

  return boxes.sort((a, b) => a.top - b.top || a.left - b.left)
}

/**
 * Graduations horaires de la grille.
 *
 * Renvoie un repère par heure pleine, avec sa position verticale.
 */
export function hourMarks(scale: GridScale): { instant: number; top: number }[] {
  const marks: { instant: number; top: number }[] = []

  // Première heure pleine à partir du début de la plage.
  const first = Math.ceil(scale.startAt / HOUR_MS) * HOUR_MS

  for (let instant = first; instant <= scale.endAt; instant += HOUR_MS) {
    marks.push({ instant, top: instantToOffset(instant, scale) })
  }

  return marks
}
