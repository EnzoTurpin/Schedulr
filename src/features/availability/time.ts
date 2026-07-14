import { formatInTimeZone, fromZonedTime } from 'date-fns-tz'
import type { Interval } from './intervals'

/**
 * Conversion entre horaires locaux récurrents et instants absolus (ADR-0003).
 *
 * ⚠️ Règle centrale : **ne jamais calculer un instant par arithmétique sur
 * minuit.** « Minuit local + 9 h » donne 10 h locales le jour du passage à
 * l'heure d'été, parce que cette journée ne dure que 23 heures. Chaque heure
 * locale est convertie explicitement, date civile comprise.
 *
 * Vérifié sur Europe/Paris en 2026 :
 *   - 29 mars : journée de 23 h, l'heure locale 02:30 n'existe pas ;
 *   - 25 octobre : journée de 25 h, l'heure locale 02:30 survient deux fois.
 */

/** Date civile `AAAA-MM-JJ` dans un fuseau donné. */
export type CivilDate = string

const MINUTE_MS = 60_000
export const DAY_MINUTES = 24 * 60

/** Date civile correspondant à un instant, dans le fuseau indiqué. */
export function civilDateOf(instant: Date | number, timezone: string): CivilDate {
  return formatInTimeZone(instant, timezone, 'yyyy-MM-dd')
}

/** Jour de la semaine local, convention `Date.getDay()` : 0 = dimanche. */
export function localDayOfWeek(date: CivilDate, timezone: string): number {
  // `i` renvoie 1 (lundi) à 7 (dimanche) ; on ramène dimanche à 0.
  const isoDay = Number(formatInTimeZone(`${date}T12:00:00Z`, timezone, 'i'))
  return isoDay % 7
}

/**
 * Instant absolu correspondant à une heure locale exprimée en minutes depuis
 * minuit, un jour civil donné.
 *
 * Les minutes peuvent dépasser 1440 : une plage se terminant à 01:00 le
 * lendemain s'écrit `endMin = 1500`. La date civile est alors décalée d'autant
 * de jours, **avant** conversion — c'est ce qui rend le calcul juste les jours
 * de changement d'heure.
 */
export function localMinutesToInstant(
  date: CivilDate,
  minutes: number,
  timezone: string,
): Date {
  const dayShift = Math.floor(minutes / DAY_MINUTES)
  const withinDay = minutes - dayShift * DAY_MINUTES

  const civil = dayShift === 0 ? date : addCivilDays(date, dayShift)
  const hh = String(Math.floor(withinDay / 60)).padStart(2, '0')
  const mm = String(withinDay % 60).padStart(2, '0')

  return fromZonedTime(`${civil}T${hh}:${mm}:00`, timezone)
}

/**
 * Décale une date civile d'un nombre de jours.
 *
 * Opère sur la date civile en UTC à midi : à midi, aucun fuseau du monde ne
 * bascule de jour, ce qui met le calcul à l'abri des changements d'heure.
 */
export function addCivilDays(date: CivilDate, days: number): CivilDate {
  const noon = new Date(`${date}T12:00:00Z`)
  noon.setUTCDate(noon.getUTCDate() + days)
  return noon.toISOString().slice(0, 10)
}

/**
 * Indique si une heure locale existe réellement ce jour-là.
 *
 * Faux uniquement pendant le saut de printemps : `fromZonedTime` rabat alors
 * l'heure manquante sur l'instant précédent, si bien que la reconversion ne
 * redonne pas l'heure demandée. Sans ce contrôle, une plage 02:00–03:00 le
 * 29 mars produirait un intervalle vide passé inaperçu.
 */
export function localTimeExists(
  date: CivilDate,
  minutes: number,
  timezone: string,
): boolean {
  const instant = localMinutesToInstant(date, minutes, timezone)
  const roundTrip = formatInTimeZone(instant, timezone, 'yyyy-MM-dd HH:mm')

  const dayShift = Math.floor(minutes / DAY_MINUTES)
  const withinDay = minutes - dayShift * DAY_MINUTES
  const civil = dayShift === 0 ? date : addCivilDays(date, dayShift)
  const expected = `${civil} ${String(Math.floor(withinDay / 60)).padStart(2, '0')}:${String(
    withinDay % 60,
  ).padStart(2, '0')}`

  return roundTrip === expected
}

/**
 * Première minute locale existante à partir de `minutes`, ce jour-là.
 *
 * Pendant le saut de printemps, `fromZonedTime` rabat une heure inexistante sur
 * un autre instant : convertir 02:30 donnerait un créneau à 01:30, c'est-à-dire
 * à un moment que le salon n'a jamais déclaré ouvert. On avance donc jusqu'à la
 * première heure réelle.
 *
 * Borné à deux heures : aucun décalage d'heure d'été connu ne dépasse ce saut,
 * et une boucle non bornée sur des dates est un risque d'interblocage
 * silencieux.
 */
function firstExistingMinute(
  date: CivilDate,
  minutes: number,
  timezone: string,
): number | null {
  for (let offset = 0; offset <= 120; offset++) {
    if (localTimeExists(date, minutes + offset, timezone)) {
      return minutes + offset
    }
  }
  return null
}

/**
 * Convertit une plage horaire locale récurrente en intervalle absolu.
 *
 * Retourne `null` si la plage est vide, inversée, ou entièrement absorbée par
 * le trou du passage à l'heure d'été.
 *
 * Une plage qui enjambe le saut est simplement plus courte : 01:00–04:00 le
 * 29 mars ne dure que deux heures réelles. C'est le comportement voulu — le
 * salon ferme bien à 04:00 affichées sur l'horloge murale.
 */
export function localRangeToInterval(
  date: CivilDate,
  startMin: number,
  endMin: number,
  timezone: string,
): Interval | null {
  const effectiveStart = firstExistingMinute(date, startMin, timezone)
  if (effectiveStart === null || effectiveStart >= endMin) {
    return null
  }

  const start = localMinutesToInstant(date, effectiveStart, timezone).getTime()
  const end = localMinutesToInstant(date, endMin, timezone).getTime()

  if (end <= start) {
    return null
  }
  return { start, end }
}

/**
 * Énumère les dates civiles couvertes par une fenêtre d'instants, dans le
 * fuseau du salon.
 *
 * Les bornes sont incluses : une fenêtre commençant à 23 h le lundi et
 * s'achevant à 1 h le mardi couvre les deux jours.
 */
export function civilDatesBetween(
  from: Date | number,
  to: Date | number,
  timezone: string,
): CivilDate[] {
  const first = civilDateOf(from, timezone)
  const last = civilDateOf(to, timezone)

  const dates: CivilDate[] = []
  let cursor = first
  // Garde-fou : une fenêtre de plus d'un an trahit un appel erroné, et une
  // boucle non bornée sur des dates est un risque d'interblocage silencieux.
  for (let guard = 0; guard < 400; guard++) {
    dates.push(cursor)
    if (cursor === last) return dates
    cursor = addCivilDays(cursor, 1)
  }

  throw new Error('civilDatesBetween : fenêtre supérieure à 400 jours')
}

/** Minuit local d'une date civile, en instant absolu. Sert d'ancrage de découpe. */
export function localMidnight(date: CivilDate, timezone: string): number {
  return localMinutesToInstant(date, 0, timezone).getTime()
}

export function minutesToMs(minutes: number): number {
  return minutes * MINUTE_MS
}
