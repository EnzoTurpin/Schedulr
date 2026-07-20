import { formatInTimeZone } from 'date-fns-tz'

/**
 * Formatage destiné à l'affichage, en français.
 *
 * Regroupé ici pour que les prix et les horaires s'affichent de la même façon
 * partout — un montant présenté différemment d'un écran à l'autre fait douter
 * de sa justesse.
 */

const EUR = new Intl.NumberFormat('fr-FR', {
  style: 'currency',
  currency: 'EUR',
  minimumFractionDigits: 2,
})

/** Montant en centimes → « 35,00 € ». */
export function formatPrice(cents: number): string {
  return EUR.format(cents / 100)
}

/** Durée en minutes → « 1 h 30 », « 45 min ». */
export function formatDuration(minutes: number): string {
  if (minutes < 60) {
    return `${minutes} min`
  }
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest === 0 ? `${hours} h` : `${hours} h ${String(rest).padStart(2, '0')}`
}

/** Minutes locales depuis minuit → « 09:30 ». */
export function formatMinutesOfDay(minutes: number): string {
  const h = Math.floor(minutes / 60) % 24
  const m = minutes % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

const DAY_NAMES = [
  'Dimanche',
  'Lundi',
  'Mardi',
  'Mercredi',
  'Jeudi',
  'Vendredi',
  'Samedi',
] as const

/** Nom du jour, convention `Date.getDay()` : 0 = dimanche. */
export function dayName(dayOfWeek: number): string {
  return DAY_NAMES[dayOfWeek] ?? ''
}

/**
 * Instant → heure locale du salon, « 14:30 ».
 *
 * Le fuseau est toujours explicite : afficher un rendez-vous dans le fuseau du
 * serveur plutôt que dans celui du salon décalerait l'heure annoncée au client.
 */
export function formatTime(instant: Date | number, timezone: string): string {
  return formatInTimeZone(instant, timezone, 'HH:mm')
}

/** Instant → « mercredi 15 juillet ». */
export function formatDayLong(instant: Date | number, timezone: string): string {
  const date = typeof instant === 'number' ? new Date(instant) : instant
  const iso = formatInTimeZone(date, timezone, 'yyyy-MM-dd')
  const [year, month, day] = iso.split('-').map(Number)
  const weekday = dayName(new Date(`${iso}T12:00:00Z`).getUTCDay()).toLowerCase()
  const monthName = new Intl.DateTimeFormat('fr-FR', {
    month: 'long',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(year!, month! - 1, day!)))

  return `${weekday} ${day} ${monthName}`
}

/** Instant → « mercredi 15 juillet à 14:30 ». */
export function formatDateTimeLong(instant: Date | number, timezone: string): string {
  return `${formatDayLong(instant, timezone)} à ${formatTime(instant, timezone)}`
}

/** Regroupe des créneaux par jour civil du salon. */
export function groupByDay<T extends { startAt: number }>(
  slots: readonly T[],
  timezone: string,
): { date: string; slots: T[] }[] {
  const groups = new Map<string, T[]>()

  for (const slot of slots) {
    const date = formatInTimeZone(slot.startAt, timezone, 'yyyy-MM-dd')
    const bucket = groups.get(date)
    if (bucket) bucket.push(slot)
    else groups.set(date, [slot])
  }

  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, daySlots]) => ({ date, slots: daySlots }))
}
