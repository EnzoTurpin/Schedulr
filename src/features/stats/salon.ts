import type { AppointmentStatus } from '@/generated/prisma'
import { assertCan } from '@/lib/authz/can'
import type { Actor } from '@/lib/authz/types'
import { forSalon } from '@/lib/db/scoped'

/**
 * Statistiques d'un salon.
 *
 * Toutes les lectures passent par le client cloisonné : un gérant ne doit
 * jamais voir un chiffre appartenant à un concurrent (ADR-0002).
 *
 * Les montants sont ceux figés dans `AppointmentItem` à la réservation, pas
 * les tarifs courants : changer un prix ne doit pas réécrire le chiffre
 * d'affaires des mois passés.
 */

export type StatsPeriod = { from: Date; to: Date }

export type SalonStats = {
  /** Rendez-vous honorés ou à venir, hors annulations. */
  appointments: number
  /** Chiffre d'affaires des prestations réalisées, en centimes. */
  revenueCents: number
  /** Chiffre attendu des rendez-vous à venir, en centimes. */
  expectedRevenueCents: number
  noShows: number
  cancellations: number
  /** Part des rendez-vous honorés sur ceux qui auraient dû l'être. */
  attendanceRate: number | null
  /** Part du temps travaillé effectivement occupée. */
  occupancyRate: number | null
  newClients: number
}

/**
 * Statuts comptant comme un rendez-vous réellement tenu.
 *
 * Typés explicitement : Prisma refuse un tuple `readonly` dans un filtre `in`.
 */
const HONOURED: AppointmentStatus[] = ['DONE']

/** Statuts occupant l'agenda : ils pèsent dans le taux de remplissage. */
const BOOKED: AppointmentStatus[] = ['PENDING', 'CONFIRMED', 'DONE', 'NO_SHOW']

export async function getSalonStats(
  actor: Actor,
  salonId: string,
  period: StatsPeriod,
): Promise<SalonStats> {
  assertCan(actor, 'stats:read', { kind: 'salon', salonId })
  const db = forSalon(salonId)

  const window = { startAt: { gte: period.from, lt: period.to } }

  const [booked, done, noShows, cancellations, items, workedMinutes, clients] =
    await Promise.all([
      db.appointment.count({ where: { ...window, status: { in: BOOKED } } }),
      db.appointment.count({ where: { ...window, status: { in: HONOURED } } }),
      db.appointment.count({ where: { ...window, status: 'NO_SHOW' } }),
      db.appointment.count({ where: { ...window, status: 'CANCELLED' } }),
      db.appointmentItem.findMany({
        where: { appointment: { ...window, status: { in: BOOKED } } },
        select: {
          priceCents: true,
          appointment: { select: { status: true } },
        },
      }),
      // Temps réellement occupé, marges comprises : c'est l'emprise agenda.
      db.appointment.findMany({
        where: { ...window, status: { in: BOOKED } },
        select: { startAt: true, endAt: true },
      }),
      db.appointment.findMany({
        where: { ...window, clientId: { not: null } },
        select: { clientId: true },
        distinct: ['clientId'],
      }),
    ])

  const revenueCents = items
    .filter((item) => item.appointment.status === 'DONE')
    .reduce((sum, item) => sum + item.priceCents, 0)

  const expectedRevenueCents = items
    .filter(
      (item) =>
        item.appointment.status === 'PENDING' || item.appointment.status === 'CONFIRMED',
    )
    .reduce((sum, item) => sum + item.priceCents, 0)

  const bookedMinutes = workedMinutes.reduce(
    (sum, appointment) =>
      sum + (appointment.endAt.getTime() - appointment.startAt.getTime()) / 60_000,
    0,
  )

  const capacityMinutes = await computeCapacityMinutes(salonId, period)

  // Le taux de présence n'a de sens que sur des rendez-vous passés : un
  // rendez-vous à venir n'est ni honoré ni manqué.
  const settled = done + noShows
  const attendanceRate = settled > 0 ? done / settled : null

  return {
    appointments: booked,
    revenueCents,
    expectedRevenueCents,
    noShows,
    cancellations,
    attendanceRate,
    occupancyRate: capacityMinutes > 0 ? bookedMinutes / capacityMinutes : null,
    newClients: clients.length,
  }
}

/**
 * Capacité théorique du salon sur la période, en minutes.
 *
 * Somme des horaires de travail de l'équipe, jour par jour. Approximation
 * assumée : les congés et fermetures ne sont pas déduits, ce qui **sous-estime**
 * le taux de remplissage — un salon fermé une semaine paraîtra moins occupé
 * qu'il ne l'était. Le corriger demanderait de rejouer le moteur de
 * disponibilité sur toute la période, ce qui n'est pas justifié pour un
 * indicateur de pilotage.
 */
/**
 * Minutes théoriquement ouvrables sur la période.
 *
 * Les congés et les fermetures sont retranchés : sans cela, un coiffeur en
 * vacances comptait toujours comme capacité et le taux d'occupation était
 * sous-estimé d'autant. L'écart était admissible tant que les congés n'étaient
 * pas saisissables ; il ne l'est plus.
 */
async function computeCapacityMinutes(
  salonId: string,
  period: StatsPeriod,
): Promise<number> {
  const db = forSalon(salonId)

  const [workingHours, timeOff, closures] = await Promise.all([
    db.workingHour.findMany({
      where: { member: { isActive: true } },
      select: { memberId: true, dayOfWeek: true, startMin: true, endMin: true },
    }),
    db.timeOff.findMany({
      where: { startAt: { lt: period.to }, endAt: { gt: period.from } },
      select: { memberId: true, startAt: true, endAt: true },
    }),
    db.closure.findMany({
      where: { startAt: { lt: period.to }, endAt: { gt: period.from } },
      select: { startAt: true, endAt: true },
    }),
  ])

  if (workingHours.length === 0) return 0

  // Nombre d'occurrences de chaque jour de semaine dans la période.
  const occurrences = new Map<number, number>()
  const cursor = new Date(period.from)
  cursor.setUTCHours(12, 0, 0, 0)

  // Borne de sécurité : au-delà d'un an, l'indicateur perd son sens et la
  // boucle deviendrait coûteuse.
  for (let guard = 0; guard < 400 && cursor < period.to; guard++) {
    const day = cursor.getUTCDay()
    occurrences.set(day, (occurrences.get(day) ?? 0) + 1)
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  }

  const gross = workingHours.reduce((sum, range) => {
    const count = occurrences.get(range.dayOfWeek) ?? 0
    return sum + (range.endMin - range.startMin) * count
  }, 0)

  /** Minutes d'une absence, bornées à la période observée. */
  const overlapMinutes = (from: Date, to: Date) => {
    const start = Math.max(from.getTime(), period.from.getTime())
    const end = Math.min(to.getTime(), period.to.getTime())
    return Math.max(0, (end - start) / 60_000)
  }

  // Part des heures travaillées d'un membre dans une journée moyenne : une
  // absence ne retire que le temps qu'il aurait effectivement ouvert, pas
  // vingt-quatre heures.
  const dailyMinutes = new Map<string, number>()
  for (const range of workingHours) {
    const width = range.endMin - range.startMin
    dailyMinutes.set(range.memberId, (dailyMinutes.get(range.memberId) ?? 0) + width)
  }
  const weeklyDays = new Set(workingHours.map((range) => range.dayOfWeek)).size || 1

  let deducted = 0

  for (const absence of timeOff) {
    const days = overlapMinutes(absence.startAt, absence.endAt) / (24 * 60)
    const perDay = (dailyMinutes.get(absence.memberId) ?? 0) / weeklyDays
    deducted += days * perDay
  }

  // Une fermeture du salon touche toute l'équipe.
  const totalPerDay =
    [...dailyMinutes.values()].reduce((sum, minutes) => sum + minutes, 0) / weeklyDays
  for (const closure of closures) {
    const days = overlapMinutes(closure.startAt, closure.endAt) / (24 * 60)
    deducted += days * totalPerDay
  }

  // La capacité ne peut pas devenir négative : congés et fermetures peuvent se
  // recouvrir, et les compter deux fois n'aurait aucun sens.
  return Math.max(0, gross - deducted)
}

/** Prestations les plus vendues sur la période. */
export async function getTopServices(
  actor: Actor,
  salonId: string,
  period: StatsPeriod,
  limit = 10,
) {
  assertCan(actor, 'stats:read', { kind: 'salon', salonId })

  const items = await forSalon(salonId).appointmentItem.findMany({
    where: {
      appointment: {
        startAt: { gte: period.from, lt: period.to },
        status: { in: BOOKED },
      },
    },
    select: { nameSnapshot: true, priceCents: true },
  })

  const totals = new Map<string, { count: number; revenueCents: number }>()
  for (const item of items) {
    const current = totals.get(item.nameSnapshot) ?? { count: 0, revenueCents: 0 }
    totals.set(item.nameSnapshot, {
      count: current.count + 1,
      revenueCents: current.revenueCents + item.priceCents,
    })
  }

  return [...totals.entries()]
    .map(([name, stats]) => ({ name, ...stats }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
    .slice(0, limit)
}

/** Activité par coiffeur sur la période. */
export async function getStaffActivity(
  actor: Actor,
  salonId: string,
  period: StatsPeriod,
) {
  assertCan(actor, 'stats:read', { kind: 'salon', salonId })
  const db = forSalon(salonId)

  const [members, appointments] = await Promise.all([
    db.salonMember.findMany({
      where: { isActive: true },
      orderBy: { displayName: 'asc' },
      select: { id: true, displayName: true },
    }),
    db.appointment.findMany({
      where: { startAt: { gte: period.from, lt: period.to }, status: { in: BOOKED } },
      select: {
        memberId: true,
        status: true,
        startAt: true,
        endAt: true,
        items: { select: { priceCents: true } },
      },
    }),
  ])

  return members.map((member) => {
    const own = appointments.filter((a) => a.memberId === member.id)
    return {
      memberId: member.id,
      displayName: member.displayName,
      appointments: own.length,
      noShows: own.filter((a) => a.status === 'NO_SHOW').length,
      minutes: own.reduce(
        (sum, a) => sum + (a.endAt.getTime() - a.startAt.getTime()) / 60_000,
        0,
      ),
      revenueCents: own
        .filter((a) => a.status === 'DONE')
        .reduce((sum, a) => sum + a.items.reduce((s, item) => s + item.priceCents, 0), 0),
    }
  })
}
