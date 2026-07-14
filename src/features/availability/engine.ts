import {
  intersect,
  normalize,
  sliceIntoStarts,
  subtract,
  type Interval,
} from './intervals'
import {
  civilDatesBetween,
  localDayOfWeek,
  localMidnight,
  localRangeToInterval,
  minutesToMs,
} from './time'
import type {
  AvailabilityInput,
  RecurringRange,
  SalonRules,
  Slot,
  StaffAvailability,
  StaffSlots,
} from './types'

/**
 * Moteur de disponibilité (ADR-0003).
 *
 * Fonctions pures : aucune lecture en base, aucun accès à l'horloge — l'instant
 * courant est passé en entrée. C'est ce qui permet de tester les changements
 * d'heure et les cas limites de calendrier sans base de données.
 *
 * Enchaînement, par coiffeur :
 *
 *   fenêtres = horaires du coiffeur ∩ horaires du salon
 *   fenêtres = fenêtres − congés − fermetures
 *   libre    = fenêtres − rendez-vous (marges comprises)
 *   créneaux = découpe(libre, pas, durée totale)
 *   filtres  = délai minimum, horizon maximum, fenêtre demandée
 */

/**
 * Déploie des plages récurrentes sur une suite de dates civiles.
 *
 * Chaque date est convertie individuellement : c'est ce qui rend le résultat
 * juste les jours de changement d'heure, où « minuit + 9 h » ne donne pas 9 h.
 */
function expandRecurring(
  ranges: readonly RecurringRange[],
  dates: readonly string[],
  timezone: string,
): Interval[] {
  const intervals: Interval[] = []

  for (const date of dates) {
    const dayOfWeek = localDayOfWeek(date, timezone)
    for (const range of ranges) {
      if (range.dayOfWeek !== dayOfWeek) continue

      const interval = localRangeToInterval(date, range.startMin, range.endMin, timezone)
      // `null` quand la plage tombe entièrement dans l'heure manquante du
      // passage à l'heure d'été : il n'y a alors rien à proposer.
      if (interval !== null) {
        intervals.push(interval)
      }
    }
  }

  return normalize(intervals)
}

/** Bornes temporelles imposées par les règles du salon. */
function bookableWindow(rules: SalonRules, now: Date): Interval {
  return {
    start: now.getTime() + minutesToMs(rules.bookingLeadTimeMin),
    end: now.getTime() + rules.bookingHorizonDays * 24 * 60 * 60 * 1000,
  }
}

/** Créneaux d'un seul coiffeur. */
function slotsForStaff(
  member: StaffAvailability,
  input: AvailabilityInput,
  dates: readonly string[],
  requested: Interval,
): Slot[] {
  const { salon, openingHours, closures } = input
  const width = minutesToMs(member.totalDurationMin)

  if (width <= 0) {
    return []
  }

  const opening = expandRecurring(openingHours, dates, salon.timezone)
  const working = expandRecurring(member.workingHours, dates, salon.timezone)

  // Un coiffeur ne travaille jamais hors des heures d'ouverture, même si sa
  // fiche déclare une amplitude plus large.
  let free = intersect(working, opening)
  free = subtract(free, member.timeOff)
  free = subtract(free, closures)
  free = subtract(free, member.busy)

  // Bornes de réservation, puis fenêtre demandée par l'appelant.
  free = intersect(free, [bookableWindow(salon, input.now)])
  free = intersect(free, [requested])

  const step = minutesToMs(salon.slotStepMin)
  const slots: Slot[] = []

  // Un ancrage par jour civil, et non un ancrage global : minuit local est le
  // repère naturel des horaires de salon, et il se décale d'une heure aux
  // changements d'heure.
  for (const date of dates) {
    const anchor = localMidnight(date, salon.timezone)
    const dayEnd = localMidnight(date, salon.timezone) + 25 * 60 * 60 * 1000
    const withinDay = intersect(free, [{ start: anchor, end: dayEnd }])

    for (const startAt of sliceIntoStarts(withinDay, { width, step, anchor })) {
      slots.push({ startAt, endAt: startAt + width, memberId: member.memberId })
    }
  }

  // Les fenêtres journalières se recouvrent d'une heure de sécurité pour
  // absorber le changement d'heure : on dédoublonne.
  const seen = new Set<number>()
  return slots
    .filter((slot) => {
      if (seen.has(slot.startAt)) return false
      seen.add(slot.startAt)
      return true
    })
    .sort((a, b) => a.startAt - b.startAt)
}

/** Créneaux de chaque coiffeur, séparément. */
export function computeSlotsByStaff(input: AvailabilityInput): StaffSlots[] {
  const dates = civilDatesBetween(input.from, input.to, input.salon.timezone)
  const requested: Interval = { start: input.from.getTime(), end: input.to.getTime() }

  return input.staff.map((member) => ({
    memberId: member.memberId,
    slots: slotsForStaff(member, input, dates, requested),
  }))
}

/**
 * Résolution « n'importe quel coiffeur ».
 *
 * Un seul créneau est proposé par instant de départ, avec un coiffeur choisi.
 * Le critère retenu est **le moins chargé du jour**, pour lisser la charge de
 * l'équipe ; les égalités sont tranchées sur l'identifiant, afin que le
 * résultat soit reproductible d'un appel à l'autre.
 *
 * Cette règle est isolée ici parce qu'elle est amenée à évoluer — équité des
 * revenus entre coiffeurs, préférence du client habituel.
 */
export function computeSlotsForAnyStaff(input: AvailabilityInput): Slot[] {
  const byStaff = computeSlotsByStaff(input)

  // Charge = nombre de rendez-vous déjà pris sur la fenêtre.
  const load = new Map<string, number>(
    input.staff.map((member) => [member.memberId, member.busy.length]),
  )

  const candidatesByStart = new Map<number, Slot[]>()
  for (const { slots } of byStaff) {
    for (const slot of slots) {
      const bucket = candidatesByStart.get(slot.startAt)
      if (bucket) {
        bucket.push(slot)
      } else {
        candidatesByStart.set(slot.startAt, [slot])
      }
    }
  }

  return [...candidatesByStart.entries()]
    .sort(([a], [b]) => a - b)
    .map(([, candidates]) => {
      const best = [...candidates].sort((a, b) => {
        const loadDiff = (load.get(a.memberId) ?? 0) - (load.get(b.memberId) ?? 0)
        if (loadDiff !== 0) return loadDiff
        return a.memberId.localeCompare(b.memberId)
      })[0]
      // `candidates` n'est jamais vide : il vient d'être construit par ajout.
      return best as Slot
    })
}
