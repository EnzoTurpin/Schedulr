import { NextResponse, type NextRequest } from 'next/server'
import { formatDate } from '@/lib/format'
import { csvHeaders, csvAmount, toCsv } from '@/lib/csv'
import { currentActor } from '@/lib/auth/actor'
import { can } from '@/lib/authz/can'
import { forSalon } from '@/lib/db/scoped'
import { crossSalon } from '@/lib/db/scoped'

/**
 * Export CSV des rendez-vous d'un salon.
 *
 * ⚠️ Ce fichier contient des données personnelles : noms et téléphones de
 * clients. L'accès est réservé aux droits de statistiques, et la réponse n'est
 * jamais mise en cache.
 */

export const dynamic = 'force-dynamic'

/** Fenêtre maximale exportable : au-delà, le fichier devient ingérable. */
const MAX_DAYS = 366

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ salonId: string }> },
) {
  const { salonId } = await params
  const actor = await currentActor()

  // Un salon voisin ne doit pas apprendre que cet export existe (ADR-0002).
  if (!actor || !can(actor, 'stats:read', { kind: 'salon', salonId })) {
    return new NextResponse(null, { status: 404 })
  }

  const url = request.nextUrl.searchParams
  const from = new Date(url.get('from') ?? '')
  const to = new Date(url.get('to') ?? '')

  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || to <= from) {
    return NextResponse.json({ error: 'Période invalide.' }, { status: 400 })
  }
  if ((to.getTime() - from.getTime()) / 86_400_000 > MAX_DAYS) {
    return NextResponse.json({ error: 'Période trop longue.' }, { status: 400 })
  }

  const salon = await crossSalon('export CSV').salon.findUnique({
    where: { id: salonId },
    select: { slug: true, timezone: true },
  })
  if (!salon) {
    return new NextResponse(null, { status: 404 })
  }

  const appointments = await forSalon(salonId).appointment.findMany({
    where: { startAt: { gte: from, lt: to } },
    orderBy: { startAt: 'asc' },
    select: {
      startAt: true,
      endAt: true,
      status: true,
      source: true,
      guestName: true,
      guestPhone: true,
      member: { select: { displayName: true } },
      client: { select: { firstName: true, lastName: true, phone: true } },
      items: { select: { nameSnapshot: true, priceCents: true } },
    },
  })

  const rows = appointments.map((appointment) => [
    formatDate(appointment.startAt, salon.timezone, 'yyyy-MM-dd'),
    formatDate(appointment.startAt, salon.timezone, 'HH:mm'),
    formatDate(appointment.endAt, salon.timezone, 'HH:mm'),
    appointment.member.displayName,
    appointment.client
      ? [appointment.client.firstName, appointment.client.lastName]
          .filter(Boolean)
          .join(' ')
      : (appointment.guestName ?? ''),
    appointment.client?.phone ?? appointment.guestPhone ?? '',
    appointment.items.map((item) => item.nameSnapshot).join(' + '),
    csvAmount(appointment.items.reduce((sum, item) => sum + item.priceCents, 0)),
    appointment.status,
    appointment.source,
  ])

  const csv = toCsv(
    [
      'Date',
      'Début',
      'Fin',
      'Coiffeur',
      'Client',
      'Téléphone',
      'Prestations',
      'Montant',
      'Statut',
      'Origine',
    ],
    rows,
  )

  const filename = `rendez-vous-${salon.slug}-${formatDate(from, salon.timezone, 'yyyy-MM-dd')}.csv`
  return new NextResponse(csv, { headers: csvHeaders(filename) })
}
