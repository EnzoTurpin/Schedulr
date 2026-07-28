import { forSalon } from '@/lib/db/scoped'
import { prisma } from '@/lib/db/client'
import type { AppointmentStatus } from '@/generated/prisma'

/**
 * Lectures de l'agenda professionnel.
 *
 * Contrairement aux créneaux publics, ces données ne passent **jamais** par le
 * cache : un gérant doit voir l'état réel de son salon (ADR-0003).
 */

/** Statuts occupant réellement un créneau dans l'agenda. */
const VISIBLE_STATUSES: AppointmentStatus[] = ['PENDING', 'CONFIRMED', 'DONE', 'NO_SHOW']

export type AgendaAppointment = {
  id: string
  memberId: string
  startAt: Date
  endAt: Date
  status: AppointmentStatus
  source: string
  clientName: string
  clientPhone: string | null
  clientNote: string | null
  staffNote: string | null
  services: string[]
  totalPriceCents: number
}

/**
 * Rendez-vous d'un salon sur une fenêtre, prêts à être placés dans la grille.
 *
 * Les rendez-vous annulés sont exclus : ils libèrent le créneau et n'ont plus
 * à encombrer le planning.
 */
export async function listAgenda(
  salonId: string,
  from: Date,
  to: Date,
  memberId?: string,
): Promise<AgendaAppointment[]> {
  const db = forSalon(salonId)

  const rows = await db.appointment.findMany({
    where: {
      status: { in: VISIBLE_STATUSES },
      // Un rendez-vous commencé avant la fenêtre mais qui empiète dessus doit
      // apparaître : on teste le chevauchement, pas l'inclusion.
      startAt: { lt: to },
      endAt: { gt: from },
      ...(memberId ? { memberId } : {}),
    },
    orderBy: { startAt: 'asc' },
    select: {
      id: true,
      memberId: true,
      startAt: true,
      endAt: true,
      status: true,
      source: true,
      guestName: true,
      guestPhone: true,
      clientNote: true,
      staffNote: true,
      client: { select: { firstName: true, lastName: true, phone: true } },
      items: {
        orderBy: { position: 'asc' },
        select: { nameSnapshot: true, priceCents: true },
      },
    },
  })

  return rows.map((row) => ({
    id: row.id,
    memberId: row.memberId,
    startAt: row.startAt,
    endAt: row.endAt,
    status: row.status,
    source: row.source,
    // Un rendez-vous pris au comptoir n'a pas de compte rattaché.
    clientName: row.client
      ? [row.client.firstName, row.client.lastName].filter(Boolean).join(' ')
      : (row.guestName ?? 'Client'),
    clientPhone: row.client?.phone ?? row.guestPhone,
    clientNote: row.clientNote,
    staffNote: row.staffNote,
    services: row.items.map((item) => item.nameSnapshot),
    totalPriceCents: row.items.reduce((sum, item) => sum + item.priceCents, 0),
  }))
}

/** Équipe réservable du salon, pour les colonnes de la grille. */
export async function listAgendaStaff(salonId: string) {
  const db = forSalon(salonId)

  return db.salonMember.findMany({
    where: { isActive: true },
    orderBy: { displayName: 'asc' },
    select: { id: true, displayName: true, color: true, isBookable: true },
  })
}

/** Catalogue actif du salon, pour la création d'un rendez-vous au comptoir. */
export async function listAgendaServices(salonId: string) {
  const db = forSalon(salonId)

  return db.service.findMany({
    where: { isActive: true },
    orderBy: { name: 'asc' },
    select: { id: true, name: true, durationMin: true, priceCents: true },
  })
}

/**
 * Fiche client vue du salon : historique et notes internes.
 *
 * Volontairement hors du client cloisonné pour la lecture du compte — un client
 * appartient à la plateforme, pas au salon. En revanche seuls les rendez-vous
 * **de ce salon** sont exposés : le fichier client d'un concurrent ne doit
 * jamais transparaître (ADR-0002).
 */
export async function getClientRecord(salonId: string, appointmentId: string) {
  const db = forSalon(salonId)

  const appointment = await db.appointment.findUnique({
    where: { id: appointmentId },
    select: { clientId: true, guestName: true, guestPhone: true, guestEmail: true },
  })

  if (!appointment) {
    return null
  }

  // Client sans compte : aucun historique à reconstituer.
  if (!appointment.clientId) {
    return {
      isGuest: true as const,
      name: appointment.guestName ?? 'Client',
      phone: appointment.guestPhone,
      email: appointment.guestEmail,
      history: [],
      noShowCount: 0,
    }
  }

  const [user, history, noShowCount] = await Promise.all([
    prisma.user.findUnique({
      where: { id: appointment.clientId },
      select: { firstName: true, lastName: true, phone: true, email: true },
    }),
    db.appointment.findMany({
      where: { clientId: appointment.clientId, id: { not: appointmentId } },
      orderBy: { startAt: 'desc' },
      take: 10,
      select: {
        id: true,
        startAt: true,
        status: true,
        member: { select: { displayName: true } },
        items: { select: { nameSnapshot: true } },
      },
    }),
    db.appointment.count({
      where: { clientId: appointment.clientId, status: 'NO_SHOW' },
    }),
  ])

  return {
    isGuest: false as const,
    name: [user?.firstName, user?.lastName].filter(Boolean).join(' ') || 'Client',
    phone: user?.phone ?? null,
    email: user?.email ?? null,
    history,
    noShowCount,
  }
}
