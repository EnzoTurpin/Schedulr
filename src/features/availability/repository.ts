import { forSalon } from '@/lib/db/scoped'
import { prisma } from '@/lib/db/client'
import type { Interval } from './intervals'
import type { AvailabilityInput, StaffAvailability } from './types'

/**
 * Chargement des données du moteur de disponibilité.
 *
 * Seule pièce du module à connaître Prisma : le moteur lui-même reste pur
 * (ADR-0003). Toutes les lectures passent par le client cloisonné par salon
 * (ADR-0002).
 *
 * Coût maîtrisé : une requête par famille de données sur la fenêtre demandée,
 * jamais une requête par jour ni par coiffeur.
 */

export class SalonNotBookableError extends Error {
  constructor() {
    super('Ce salon n’accepte pas de réservation en ligne.')
    this.name = 'SalonNotBookableError'
  }
}

export type AvailabilityQuery = {
  salonId: string
  /** Prestations demandées, dans l'ordre choisi par le client. */
  serviceIds: string[]
  /** Coiffeur imposé, ou `null` pour « n'importe lequel ». */
  memberId: string | null
  from: Date
  to: Date
  /** Injecté pour rendre les appels testables et déterministes. */
  now?: Date
}

/**
 * Assemble les entrées du moteur.
 *
 * @throws {SalonNotBookableError} salon inconnu ou désactivé.
 */
export async function loadAvailabilityInput(
  query: AvailabilityQuery,
): Promise<AvailabilityInput> {
  const { salonId, serviceIds, memberId, from, to } = query
  const now = query.now ?? new Date()
  const db = forSalon(salonId)

  // `Salon` n'est pas une table cloisonnée : c'est la table des tenants
  // elle-même (voir tenant-models.ts).
  const salon = await prisma.salon.findUnique({
    where: { id: salonId },
    select: {
      id: true,
      isActive: true,
      timezone: true,
      bookingLeadTimeMin: true,
      bookingHorizonDays: true,
      slotStepMin: true,
      openingHours: { select: { dayOfWeek: true, startMin: true, endMin: true } },
    },
  })

  if (!salon || !salon.isActive) {
    throw new SalonNotBookableError()
  }

  if (serviceIds.length === 0) {
    throw new Error('loadAvailabilityInput : aucune prestation demandée')
  }

  // Prestations demandées, avec leurs durées et marges de référence.
  const services = await db.service.findMany({
    where: { id: { in: serviceIds }, isActive: true },
    select: {
      id: true,
      durationMin: true,
      bufferBeforeMin: true,
      bufferAfterMin: true,
    },
  })

  if (services.length !== new Set(serviceIds).size) {
    // Une prestation inconnue, désactivée ou appartenant à un autre salon.
    throw new SalonNotBookableError()
  }

  // Coiffeurs candidats : actifs, réservables, et réalisant **toutes** les
  // prestations demandées. Le filtrage sur le nombre d'affectations est fait
  // en base plutôt qu'en mémoire, pour ne pas charger toute l'équipe.
  const candidates = await db.salonMember.findMany({
    where: {
      isActive: true,
      isBookable: true,
      ...(memberId ? { id: memberId } : {}),
      services: { some: { serviceId: { in: serviceIds } } },
    },
    select: {
      id: true,
      services: {
        where: { serviceId: { in: serviceIds } },
        select: { serviceId: true, durationMin: true },
      },
      workingHours: { select: { dayOfWeek: true, startMin: true, endMin: true } },
    },
  })

  const eligible = candidates.filter(
    (member) => member.services.length === new Set(serviceIds).size,
  )

  if (eligible.length === 0) {
    return {
      salon: {
        timezone: salon.timezone,
        bookingLeadTimeMin: salon.bookingLeadTimeMin,
        bookingHorizonDays: salon.bookingHorizonDays,
        slotStepMin: salon.slotStepMin,
      },
      openingHours: salon.openingHours,
      closures: [],
      staff: [],
      from,
      to,
      now,
    }
  }

  const memberIds = eligible.map((member) => member.id)

  // Les rendez-vous et absences sont chargés sur une fenêtre élargie d'un jour
  // de part et d'autre : un rendez-vous commencé la veille au soir peut
  // empiéter sur le premier créneau demandé.
  const margin = 24 * 60 * 60 * 1000
  const windowStart = new Date(from.getTime() - margin)
  const windowEnd = new Date(to.getTime() + margin)
  const overlapsWindow = { startAt: { lt: windowEnd }, endAt: { gt: windowStart } }

  const [closures, timeOff, appointments] = await Promise.all([
    db.closure.findMany({
      where: overlapsWindow,
      select: { startAt: true, endAt: true },
    }),
    db.timeOff.findMany({
      where: { memberId: { in: memberIds }, ...overlapsWindow },
      select: { memberId: true, startAt: true, endAt: true },
    }),
    db.appointment.findMany({
      where: {
        memberId: { in: memberIds },
        // Seuls les rendez-vous actifs occupent le créneau, exactement comme la
        // contrainte d'exclusion en base (ADR-0004).
        status: { in: ['PENDING', 'CONFIRMED'] },
        ...overlapsWindow,
      },
      select: { memberId: true, startAt: true, endAt: true },
    }),
  ])

  const toInterval = (row: { startAt: Date; endAt: Date }): Interval => ({
    start: row.startAt.getTime(),
    end: row.endAt.getTime(),
  })

  const byMember = <T extends { memberId: string }>(rows: T[]) => {
    const map = new Map<string, T[]>()
    for (const row of rows) {
      const bucket = map.get(row.memberId)
      if (bucket) bucket.push(row)
      else map.set(row.memberId, [row])
    }
    return map
  }

  const timeOffByMember = byMember(timeOff)
  const appointmentsByMember = byMember(appointments)

  const staff: StaffAvailability[] = eligible.map((member) => {
    // La durée dépend du couple prestation/coiffeur : une coloration prend plus
    // de temps chez un apprenti. `durationMin` nul signifie « valeur du
    // service ».
    const overrides = new Map(member.services.map((s) => [s.serviceId, s.durationMin]))

    const totalDurationMin = services.reduce((total, service) => {
      const duration = overrides.get(service.id) ?? service.durationMin
      return total + duration + service.bufferBeforeMin + service.bufferAfterMin
    }, 0)

    return {
      memberId: member.id,
      workingHours: member.workingHours,
      timeOff: (timeOffByMember.get(member.id) ?? []).map(toInterval),
      busy: (appointmentsByMember.get(member.id) ?? []).map(toInterval),
      totalDurationMin,
    }
  })

  return {
    salon: {
      timezone: salon.timezone,
      bookingLeadTimeMin: salon.bookingLeadTimeMin,
      bookingHorizonDays: salon.bookingHorizonDays,
      slotStepMin: salon.slotStepMin,
    },
    openingHours: salon.openingHours,
    closures: closures.map(toInterval),
    staff,
    from,
    to,
    now,
  }
}
