import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { formatInTimeZone } from 'date-fns-tz'
import {
  AgendaBoard,
  type AgendaEvent,
  type AgendaView,
} from '@/features/agenda/AgendaBoard'
import {
  listAgenda,
  listAgendaServices,
  listAgendaStaff,
} from '@/features/agenda/queries'
import type { CalendarResource } from '@/features/calendar/CalendarGrid'
import { addCivilDays, localMinutesToInstant } from '@/features/availability/time'
import { requireActor } from '@/lib/auth/actor'
import { can } from '@/lib/authz/can'
import { crossSalon } from '@/lib/db/scoped'
import { formatDate } from '@/lib/format'

export const metadata: Metadata = { title: 'Agenda' }

type Props = {
  params: Promise<{ salonId: string }>
  searchParams: Promise<{ date?: string; view?: string; membre?: string }>
}

/** Amplitude affichée, en heures locales du salon. */
const GRID_START_HOUR = 8
const GRID_END_HOUR = 20
const HOUR_HEIGHT = 64

/** Lundi de la semaine contenant `date`. */
function startOfWeek(date: string): string {
  const noon = new Date(`${date}T12:00:00Z`)
  // `getUTCDay()` : 0 = dimanche. On ramène au lundi précédent.
  const offset = (noon.getUTCDay() + 6) % 7
  return addCivilDays(date, -offset)
}

export default async function AgendaPage({ params, searchParams }: Props) {
  const { salonId } = await params
  const query = await searchParams
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

  const view: AgendaView = query.view === 'week' ? 'week' : 'day'
  const requested =
    query.date && /^\d{4}-\d{2}-\d{2}$/.test(query.date)
      ? query.date
      : formatInTimeZone(new Date(), salon.timezone, 'yyyy-MM-dd')
  const date = view === 'week' ? startOfWeek(requested) : requested

  const [staff, services] = await Promise.all([
    listAgendaStaff(salonId),
    listAgendaServices(salonId),
  ])

  // Coiffeur affiché en vue semaine, borné à l'équipe réelle : un identifiant
  // arbitraire dans l'URL ne doit pas produire un agenda vide sans explication.
  const memberId =
    view === 'week'
      ? (staff.find((member) => member.id === query.membre)?.id ?? staff[0]?.id)
      : undefined

  /** Bornes locales d'un jour civil, converties en instants (ADR-0003). */
  const dayBounds = (day: string) => ({
    from: localMinutesToInstant(day, GRID_START_HOUR * 60, salon.timezone),
    to: localMinutesToInstant(day, GRID_END_HOUR * 60, salon.timezone),
  })

  const days =
    view === 'week' ? Array.from({ length: 7 }, (_, i) => addCivilDays(date, i)) : [date]
  const first = dayBounds(days[0]!)
  const last = dayBounds(days.at(-1)!)

  const appointments = await listAgenda(salonId, first.from, last.to, memberId)

  const toEvent = (
    appointment: Awaited<ReturnType<typeof listAgenda>>[number],
    resourceId: string,
  ): AgendaEvent => ({
    id: appointment.id,
    resourceId,
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
  })

  let resources: CalendarResource[]
  let events: AgendaEvent[]

  if (view === 'week') {
    // Une colonne par jour, chacune avec sa propre échelle : le jour du
    // changement d'heure, les bornes locales ne se déduisent pas par simple
    // arithmétique sur le premier jour.
    resources = days.map((day) => {
      const bounds = dayBounds(day)
      return {
        id: day,
        label: formatDate(new Date(`${day}T12:00:00Z`), salon.timezone, 'EEE d'),
        color: staff.find((member) => member.id === memberId)?.color ?? '#8b5cf6',
        scale: {
          startAt: bounds.from.getTime(),
          endAt: bounds.to.getTime(),
          hourHeight: HOUR_HEIGHT,
        },
      }
    })
    events = appointments.map((appointment) =>
      toEvent(
        appointment,
        formatInTimeZone(appointment.startAt, salon.timezone, 'yyyy-MM-dd'),
      ),
    )
  } else {
    resources = staff.map((member) => ({
      id: member.id,
      label: member.displayName,
      color: member.color,
    }))
    events = appointments.map((appointment) => toEvent(appointment, appointment.memberId))
  }

  return (
    <>
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          {/* Un membre de plusieurs salons doit pouvoir revenir à sa liste. */}
          <p className="text-sm text-slate-500">
            <Link href="/pro" className="underline">
              ← Mes salons
            </Link>
          </p>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight">{salon.name}</h1>
          <p className="mt-1 text-sm text-slate-600">Agenda du salon</p>
        </div>
        <div className="flex gap-3">
          {can(actor, 'stats:read', resource) && (
            <Link
              href={`/pro/${salonId}/statistiques`}
              className="rounded-md border border-slate-300 px-4 py-2 text-sm"
            >
              Statistiques
            </Link>
          )}
          {can(actor, 'service:manage', resource) && (
            <Link
              href={`/pro/${salonId}/configuration`}
              className="rounded-md border border-slate-300 px-4 py-2 text-sm"
            >
              Configuration
            </Link>
          )}
        </div>
      </div>

      <div className="mt-8">
        <AgendaBoard
          salonId={salonId}
          timezone={salon.timezone}
          date={date}
          view={view}
          resources={resources}
          staff={staff.map((member) => ({ id: member.id, label: member.displayName }))}
          memberId={memberId}
          events={events}
          services={services}
          scale={{
            startAt: first.from.getTime(),
            endAt: first.to.getTime(),
            hourHeight: HOUR_HEIGHT,
          }}
          canWrite={can(actor, 'appointment:write_any', resource)}
        />
      </div>
    </>
  )
}
