import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { formatInTimeZone } from 'date-fns-tz'
import { AgendaBoard, type AgendaEvent } from '@/features/agenda/AgendaBoard'
import { listAgenda, listAgendaStaff } from '@/features/agenda/queries'
import { localMinutesToInstant } from '@/features/availability/time'
import { requireActor } from '@/lib/auth/actor'
import { can } from '@/lib/authz/can'
import { crossSalon } from '@/lib/db/scoped'

export const metadata: Metadata = { title: 'Agenda' }

type Props = {
  params: Promise<{ salonId: string }>
  searchParams: Promise<{ date?: string }>
}

/** Amplitude affichée par défaut, en heures locales. */
const GRID_START_HOUR = 8
const GRID_END_HOUR = 20

export default async function AgendaPage({ params, searchParams }: Props) {
  const { salonId } = await params
  const { date: rawDate } = await searchParams
  const actor = await requireActor()

  // Contrôle serveur : le middleware n'a fait que constater un cookie.
  const resource = { kind: 'salon' as const, salonId }
  if (!can(actor, 'agenda:read_salon', resource)) {
    notFound()
  }

  const salon = await crossSalon('agenda professionnel').salon.findUnique({
    where: { id: salonId },
    select: { id: true, name: true, timezone: true },
  })

  if (!salon) {
    notFound()
  }

  const date =
    rawDate && /^\d{4}-\d{2}-\d{2}$/.test(rawDate)
      ? rawDate
      : formatInTimeZone(new Date(), salon.timezone, 'yyyy-MM-dd')

  // Bornes de la grille converties depuis l'heure locale du salon : le jour du
  // changement d'heure, « minuit + 8 h » ne donnerait pas 8 h (ADR-0003).
  const from = localMinutesToInstant(date, GRID_START_HOUR * 60, salon.timezone)
  const to = localMinutesToInstant(date, GRID_END_HOUR * 60, salon.timezone)

  const [staff, appointments] = await Promise.all([
    listAgendaStaff(salonId),
    listAgenda(salonId, from, to),
  ])

  const events: AgendaEvent[] = appointments.map((appointment) => ({
    id: appointment.id,
    resourceId: appointment.memberId,
    startAt: appointment.startAt.getTime(),
    endAt: appointment.endAt.getTime(),
    title: appointment.clientName,
    subtitle: appointment.services.join(', '),
    status: appointment.status,
    clientPhone: appointment.clientPhone,
    staffNote: appointment.staffNote,
    clientNote: appointment.clientNote,
    services: appointment.services,
    totalPriceCents: appointment.totalPriceCents,
  }))

  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">{salon.name}</h1>
      <p className="mt-1 text-sm text-slate-600">Agenda du salon</p>

      <div className="mt-8">
        <AgendaBoard
          salonId={salonId}
          timezone={salon.timezone}
          date={date}
          resources={staff.map((member) => ({
            id: member.id,
            label: member.displayName,
            color: member.color,
          }))}
          events={events}
          scale={{
            startAt: from.getTime(),
            endAt: to.getTime(),
            hourHeight: 64,
          }}
          canWrite={can(actor, 'appointment:write_any', resource)}
        />
      </div>
    </>
  )
}
