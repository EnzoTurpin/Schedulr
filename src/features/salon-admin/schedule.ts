import { invalidateSalon } from '@/features/availability'
import { DAY_MINUTES } from '@/features/availability/time'
import { assertCan } from '@/lib/authz/can'
import { ResourceNotFoundError, type Actor } from '@/lib/authz/types'
import { forSalon } from '@/lib/db/scoped'

/**
 * Horaires d'ouverture et fermetures exceptionnelles.
 *
 * Les horaires sont exprimés en minutes locales depuis minuit ; les fermetures
 * sont des instants absolus (ADR-0003).
 */

export type DayRange = { startMin: number; endMin: number }

/** Horaires d'une semaine : sept jours, plusieurs plages possibles par jour. */
export type WeekSchedule = Record<number, DayRange[]>

export class InvalidScheduleError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'InvalidScheduleError'
  }
}

/**
 * Valide un jeu de plages pour un jour donné.
 *
 * Deux règles : une plage doit avoir une durée positive, et deux plages du même
 * jour ne peuvent pas se chevaucher. Sans cette seconde règle, une coupure
 * déjeuner mal saisie (9 h–14 h puis 12 h–19 h) produirait des créneaux
 * incohérents que le moteur fusionnerait silencieusement.
 */
export function validateDayRanges(ranges: readonly DayRange[]): void {
  for (const range of ranges) {
    if (range.startMin < 0 || range.endMin > DAY_MINUTES * 2) {
      throw new InvalidScheduleError('Horaire hors des bornes admises.')
    }
    if (range.endMin <= range.startMin) {
      throw new InvalidScheduleError('L’heure de fermeture doit suivre l’ouverture.')
    }
  }

  const sorted = [...ranges].sort((a, b) => a.startMin - b.startMin)
  for (let i = 1; i < sorted.length; i++) {
    const previous = sorted[i - 1]!
    const current = sorted[i]!
    if (current.startMin < previous.endMin) {
      throw new InvalidScheduleError('Deux plages du même jour se chevauchent.')
    }
  }
}

export async function getOpeningHours(
  actor: Actor,
  salonId: string,
): Promise<WeekSchedule> {
  assertCan(actor, 'schedule:manage_salon', { kind: 'salon', salonId })

  const rows = await forSalon(salonId).openingHour.findMany({
    orderBy: [{ dayOfWeek: 'asc' }, { startMin: 'asc' }],
    select: { dayOfWeek: true, startMin: true, endMin: true },
  })

  const week: WeekSchedule = {}
  for (const row of rows) {
    ;(week[row.dayOfWeek] ??= []).push({ startMin: row.startMin, endMin: row.endMin })
  }
  return week
}

/**
 * Remplace intégralement les horaires d'ouverture.
 *
 * Remplacement en bloc plutôt que modification ligne à ligne : l'écran présente
 * la semaine entière, et un enregistrement partiel laisserait des plages
 * orphelines si une ligne échouait.
 */
export async function replaceOpeningHours(
  actor: Actor,
  salonId: string,
  week: WeekSchedule,
) {
  assertCan(actor, 'schedule:manage_salon', { kind: 'salon', salonId })

  for (const ranges of Object.values(week)) {
    validateDayRanges(ranges)
  }

  const db = forSalon(salonId)
  const rows = Object.entries(week).flatMap(([day, ranges]) =>
    ranges.map((range) => ({
      salonId,
      dayOfWeek: Number(day),
      startMin: range.startMin,
      endMin: range.endMin,
    })),
  )

  // Transaction : à aucun moment le salon ne doit se retrouver sans horaires
  // si la seconde requête échoue.
  await db.$transaction([
    db.openingHour.deleteMany({}),
    ...(rows.length > 0 ? [db.openingHour.createMany({ data: rows })] : []),
  ])

  invalidateSalon(salonId)
}

export async function listClosures(actor: Actor, salonId: string, from = new Date()) {
  assertCan(actor, 'schedule:manage_salon', { kind: 'salon', salonId })

  return forSalon(salonId).closure.findMany({
    where: { endAt: { gte: from } },
    orderBy: { startAt: 'asc' },
    select: { id: true, startAt: true, endAt: true, reason: true },
  })
}

export async function createClosure(
  actor: Actor,
  salonId: string,
  input: { startAt: Date; endAt: Date; reason?: string | null },
) {
  assertCan(actor, 'schedule:manage_salon', { kind: 'salon', salonId })

  if (input.endAt.getTime() <= input.startAt.getTime()) {
    throw new InvalidScheduleError('La fin de la fermeture doit suivre son début.')
  }

  const closure = await forSalon(salonId).closure.create({
    data: { salonId, ...input, reason: input.reason ?? null },
    select: { id: true, startAt: true, endAt: true, reason: true },
  })

  invalidateSalon(salonId)
  return closure
}

export async function deleteClosure(actor: Actor, salonId: string, closureId: string) {
  assertCan(actor, 'schedule:manage_salon', { kind: 'salon', salonId })
  const db = forSalon(salonId)

  const existing = await db.closure.findUnique({
    where: { id: closureId },
    select: { id: true },
  })
  if (!existing) throw new ResourceNotFoundError()

  await db.closure.delete({ where: { id: closureId } })
  invalidateSalon(salonId)
}

/**
 * Rendez-vous actifs qu'une fermeture rendrait caducs.
 *
 * Consulté avant d'enregistrer : fermer une journée déjà réservée est un choix
 * légitime, mais le gérant doit savoir combien de clients il devra prévenir.
 */
export async function countAffectedAppointments(
  actor: Actor,
  salonId: string,
  range: { startAt: Date; endAt: Date },
) {
  assertCan(actor, 'schedule:manage_salon', { kind: 'salon', salonId })

  return forSalon(salonId).appointment.count({
    where: {
      status: { in: ['PENDING', 'CONFIRMED'] },
      startAt: { lt: range.endAt },
      endAt: { gt: range.startAt },
    },
  })
}
