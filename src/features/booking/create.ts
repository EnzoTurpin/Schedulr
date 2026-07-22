import { getAvailability, invalidateSalon } from '@/features/availability'
import { withSlotConflictMapping } from '@/lib/db/errors'
import { forSalon } from '@/lib/db/scoped'
import type { Actor } from '@/lib/authz/types'
import { SlotUnavailableError } from './errors'

/**
 * Création d'un rendez-vous.
 *
 * Trois principes gouvernent cette fonction :
 *
 *  1. **Rien de ce qui vient du client n'est cru.** L'heure de fin, les durées
 *     et les prix sont recalculés côté serveur à partir de la base. Un client
 *     qui poste une durée de 5 minutes pour une coloration obtiendrait sinon un
 *     créneau à un prix erroné.
 *  2. **Le créneau est revérifié**, cache désactivé, juste avant l'écriture.
 *     L'interface a pu afficher une liste vieille de quelques secondes.
 *  3. **La garantie finale appartient à la base** : même après revérification,
 *     une réservation concurrente peut gagner la course. La contrainte
 *     d'exclusion (ADR-0004) tranche, et l'erreur est traduite en conflit
 *     métier.
 */

export type CreateBookingInput = {
  salonId: string
  serviceIds: string[]
  /** Coiffeur choisi, ou `null` pour « n'importe lequel ». */
  memberId: string | null
  /** Début souhaité. La fin est calculée par le serveur. */
  startAt: Date
  clientNote?: string
  /** Injecté pour rendre les tests déterministes. */
  now?: Date
}

export type CreateBookingResult = {
  appointmentId: string
  memberId: string
  startAt: Date
  endAt: Date
  totalPriceCents: number
}

/**
 * @throws {SlotUnavailableError} créneau non proposé par le moteur.
 * @throws {SlotConflictError} créneau pris par une réservation concurrente.
 */
export async function createBooking(
  actor: Actor,
  input: CreateBookingInput,
): Promise<CreateBookingResult> {
  const now = input.now ?? new Date()
  const db = forSalon(input.salonId)

  // Fenêtre volontairement étroite : on ne revérifie que la journée du créneau
  // demandé, pas tout l'horizon de réservation.
  const dayStart = new Date(input.startAt.getTime() - 24 * 60 * 60 * 1000)
  const dayEnd = new Date(input.startAt.getTime() + 24 * 60 * 60 * 1000)

  const availability = await getAvailability(
    {
      salonId: input.salonId,
      serviceIds: input.serviceIds,
      memberId: input.memberId,
      from: dayStart,
      to: dayEnd,
      now,
    },
    // Jamais depuis le cache : c'est le contrôle qui précède immédiatement
    // l'écriture.
    { cache: false },
  )

  const target = input.startAt.getTime()
  const slot = availability.slots.find((candidate) => candidate.startAt === target)

  if (!slot) {
    throw new SlotUnavailableError()
  }

  // Le coiffeur retenu vient du moteur, jamais du formulaire : en mode
  // « n'importe lequel », c'est lui qui arbitre.
  const memberId = slot.memberId

  // Durées et prix relus en base pour figer un instantané fidèle.
  const [services, overrides] = await Promise.all([
    db.service.findMany({
      where: { id: { in: input.serviceIds }, isActive: true },
      select: {
        id: true,
        name: true,
        durationMin: true,
        priceCents: true,
        bufferBeforeMin: true,
        bufferAfterMin: true,
      },
    }),
    db.staffService.findMany({
      where: { memberId, serviceId: { in: input.serviceIds } },
      select: { serviceId: true, durationMin: true, priceCents: true },
    }),
  ])

  if (services.length !== new Set(input.serviceIds).size) {
    throw new SlotUnavailableError()
  }

  const overrideByService = new Map(overrides.map((o) => [o.serviceId, o]))

  // L'ordre du client est conservé : il détermine l'enchaînement des
  // prestations dans l'agenda.
  const items = input.serviceIds.map((serviceId, position) => {
    const service = services.find((s) => s.id === serviceId)
    if (!service) {
      throw new SlotUnavailableError()
    }
    const override = overrideByService.get(serviceId)

    return {
      serviceId,
      nameSnapshot: service.name,
      durationMin: override?.durationMin ?? service.durationMin,
      priceCents: override?.priceCents ?? service.priceCents,
      position,
      // Les marges bloquent l'agenda sans être facturées.
      bufferMin: service.bufferBeforeMin + service.bufferAfterMin,
    }
  })

  const totalDurationMin = items.reduce(
    (sum, item) => sum + item.durationMin + item.bufferMin,
    0,
  )
  const totalPriceCents = items.reduce((sum, item) => sum + item.priceCents, 0)
  const endAt = new Date(input.startAt.getTime() + totalDurationMin * 60_000)

  const appointment = await withSlotConflictMapping(() =>
    db.appointment.create({
      data: {
        // Redondant avec l'injection du client scopé, mais exigé par le
        // typage : l'extension Prisma agit à l'exécution, pas à la
        // compilation. La valeur est identique, l'injection est sans effet.
        salonId: input.salonId,
        memberId,
        clientId: actor.userId,
        startAt: input.startAt,
        endAt,
        source: 'ONLINE',
        clientNote: input.clientNote ?? null,
        items: {
          create: items.map(({ bufferMin: _bufferMin, ...item }) => ({
            salonId: input.salonId,
            ...item,
          })),
        },
      },
      select: { id: true, startAt: true, endAt: true },
    }),
  )

  // Sans cette invalidation, le créneau resterait proposé jusqu'à expiration du
  // cache.
  invalidateSalon(input.salonId)

  return {
    appointmentId: appointment.id,
    memberId,
    startAt: appointment.startAt,
    endAt: appointment.endAt,
    totalPriceCents,
  }
}
