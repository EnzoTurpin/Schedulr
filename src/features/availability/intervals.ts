/**
 * Algèbre d'intervalles temporels.
 *
 * Socle du moteur de disponibilité (ADR-0003). Volontairement **pur** : aucune
 * dépendance à Prisma, aux fuseaux ni à l'horloge. C'est ce qui permet de
 * couvrir exhaustivement les cas limites en quelques millisecondes.
 *
 * Convention : un intervalle est **semi-ouvert** `[start, end)`, exprimé en
 * millisecondes depuis l'époque Unix. La même convention que la contrainte
 * d'exclusion PostgreSQL (`'[)'`, ADR-0004) — deux plages qui se touchent ne se
 * chevauchent donc pas, et 14 h–15 h laisse 15 h libre.
 */

export type Interval = {
  /** Début inclus, en millisecondes epoch. */
  start: number
  /** Fin exclue, en millisecondes epoch. */
  end: number
}

/** Durée en millisecondes. Négative impossible après `normalize`. */
export function duration(interval: Interval): number {
  return interval.end - interval.start
}

export function isEmpty(interval: Interval): boolean {
  return interval.end <= interval.start
}

/**
 * Trie, élimine les intervalles vides et fusionne ceux qui se chevauchent ou
 * se touchent.
 *
 * Toutes les autres fonctions supposent leurs entrées normalisées : les
 * appliquer à des données brutes donnerait des résultats faux plutôt qu'une
 * erreur, d'où la normalisation systématique en tête de chaque opération.
 */
export function normalize(intervals: readonly Interval[]): Interval[] {
  const sorted = intervals.filter((i) => !isEmpty(i)).sort((a, b) => a.start - b.start)

  const merged: Interval[] = []
  for (const current of sorted) {
    const last = merged[merged.length - 1]
    if (last !== undefined && current.start <= last.end) {
      // Chevauchement ou contiguïté : on étend le précédent.
      last.end = Math.max(last.end, current.end)
    } else {
      merged.push({ ...current })
    }
  }
  return merged
}

/**
 * Intersection de deux ensembles d'intervalles : les instants couverts par les
 * deux à la fois.
 *
 * Sert à croiser les horaires d'un coiffeur avec ceux de son salon — un
 * coiffeur ne travaille jamais hors des heures d'ouverture, même si sa fiche
 * dit le contraire.
 */
export function intersect(
  left: readonly Interval[],
  right: readonly Interval[],
): Interval[] {
  const a = normalize(left)
  const b = normalize(right)
  const result: Interval[] = []

  let i = 0
  let j = 0
  while (i < a.length && j < b.length) {
    const x = a[i]
    const y = b[j]
    if (x === undefined || y === undefined) break

    const start = Math.max(x.start, y.start)
    const end = Math.min(x.end, y.end)
    if (start < end) {
      result.push({ start, end })
    }

    // On avance celui qui se termine le plus tôt : l'autre peut encore
    // croiser le suivant.
    if (x.end < y.end) {
      i++
    } else {
      j++
    }
  }

  return result
}

/**
 * Soustraction : ce qui reste de `base` une fois `blockers` retiré.
 *
 * Sert à retirer les congés, les fermetures et les rendez-vous déjà pris des
 * plages travaillées.
 */
export function subtract(
  base: readonly Interval[],
  blockers: readonly Interval[],
): Interval[] {
  const holes = normalize(blockers)
  if (holes.length === 0) {
    return normalize(base)
  }

  const result: Interval[] = []
  for (const piece of normalize(base)) {
    let cursor = piece.start

    for (const hole of holes) {
      if (hole.end <= cursor) continue // trou déjà dépassé
      if (hole.start >= piece.end) break // trous suivants hors de la pièce

      if (hole.start > cursor) {
        result.push({ start: cursor, end: Math.min(hole.start, piece.end) })
      }
      cursor = Math.max(cursor, hole.end)
      if (cursor >= piece.end) break
    }

    if (cursor < piece.end) {
      result.push({ start: cursor, end: piece.end })
    }
  }

  return result.filter((i) => !isEmpty(i))
}

/** Union de plusieurs ensembles. */
export function union(...sets: readonly Interval[][]): Interval[] {
  return normalize(sets.flat())
}

/** Élargit chaque intervalle de `before` avant et `after` après. */
export function pad(
  intervals: readonly Interval[],
  before: number,
  after: number,
): Interval[] {
  return normalize(
    intervals.map((i) => ({ start: i.start - before, end: i.end + after })),
  )
}

/**
 * Découpe des plages libres en instants de départ possibles.
 *
 * Un créneau n'est retenu que si la totalité de `width` tient dans une **seule**
 * plage libre : une prestation ne peut pas enjamber une pause déjeuner ni un
 * rendez-vous déjà pris.
 *
 * Les départs sont alignés sur `step` à partir de `anchor`, et non du début de
 * chaque plage : sans cet ancrage, une plage commençant à 9 h 07 proposerait
 * des créneaux à 9 h 07, 9 h 22… au lieu de 9 h 15, 9 h 30.
 *
 * @param width Durée totale à réserver, marges comprises.
 * @param step Granularité des départs proposés.
 * @param anchor Instant de référence de l'alignement (typiquement minuit local).
 */
export function sliceIntoStarts(
  free: readonly Interval[],
  { width, step, anchor }: { width: number; step: number; anchor: number },
): number[] {
  if (width <= 0 || step <= 0) {
    throw new Error('sliceIntoStarts : width et step doivent être strictement positifs')
  }

  const starts: number[] = []
  for (const window of normalize(free)) {
    if (duration(window) < width) continue

    // Premier multiple de `step` après `anchor` qui tombe dans la plage.
    const offset = window.start - anchor
    const alignedOffset = Math.ceil(offset / step) * step
    let cursor = anchor + alignedOffset

    while (cursor + width <= window.end) {
      starts.push(cursor)
      cursor += step
    }
  }

  return starts
}

/** Vrai si l'instant est couvert par l'un des intervalles. */
export function contains(intervals: readonly Interval[], instant: number): boolean {
  return intervals.some((i) => instant >= i.start && instant < i.end)
}

/** Durée cumulée d'un ensemble, une fois normalisé. */
export function totalDuration(intervals: readonly Interval[]): number {
  return normalize(intervals).reduce((sum, i) => sum + duration(i), 0)
}
