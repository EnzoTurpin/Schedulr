import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { StatsView } from '@/features/stats/StatsView'
import { getSalonStats, getStaffActivity, getTopServices } from '@/features/stats/salon'
import { listFailedNotifications } from '@/features/notifications/reminders'
import { requireActor } from '@/lib/auth/actor'
import { can } from '@/lib/authz/can'
import { crossSalon } from '@/lib/db/scoped'
import { formatDate } from '@/lib/format'

export const metadata: Metadata = { title: 'Statistiques' }

type Props = {
  params: Promise<{ salonId: string }>
  searchParams: Promise<{ from?: string; to?: string }>
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

export default async function StatsPage({ params, searchParams }: Props) {
  const { salonId } = await params
  const query = await searchParams
  const actor = await requireActor()

  const resource = { kind: 'salon' as const, salonId }
  if (!can(actor, 'stats:read', resource)) {
    notFound()
  }

  const salon = await crossSalon('statistiques du salon').salon.findUnique({
    where: { id: salonId },
    select: { name: true, timezone: true },
  })
  if (!salon) notFound()

  // Par défaut : les trente derniers jours.
  const today = new Date()
  const defaultFrom = new Date(today.getTime() - 30 * 24 * 3_600_000)
  const from =
    query.from && ISO_DATE.test(query.from) ? new Date(query.from) : defaultFrom
  const to = query.to && ISO_DATE.test(query.to) ? new Date(query.to) : today

  const [stats, topServices, staff, failures] = await Promise.all([
    getSalonStats(actor, salonId, { from, to }),
    getTopServices(actor, salonId, { from, to }),
    getStaffActivity(actor, salonId, { from, to }),
    listFailedNotifications(actor, salonId, 5),
  ])

  const isoFrom = from.toISOString().slice(0, 10)
  const isoTo = to.toISOString().slice(0, 10)

  return (
    <>
      <p className="text-sm text-slate-500">
        <Link href={`/pro/${salonId}`} className="underline">
          ← Retour à l’agenda
        </Link>
      </p>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight">Statistiques</h1>
      <p className="mt-1 text-sm text-slate-600">{salon.name}</p>

      <form className="mt-6 flex flex-wrap items-end gap-3" action="">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="from" className="text-sm font-medium">
            Du
          </label>
          <input
            id="from"
            name="from"
            type="date"
            defaultValue={isoFrom}
            className="rounded-md border border-slate-300 px-3 py-2"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="to" className="text-sm font-medium">
            Au
          </label>
          <input
            id="to"
            name="to"
            type="date"
            defaultValue={isoTo}
            className="rounded-md border border-slate-300 px-3 py-2"
          />
        </div>
        <button
          type="submit"
          className="rounded-md border border-slate-300 px-4 py-2 text-sm"
        >
          Actualiser
        </button>
      </form>

      {failures.length > 0 && (
        <section
          aria-labelledby="envois-echoues"
          className="mt-8 rounded-lg border border-amber-300 bg-amber-50 p-5"
        >
          <h2 id="envois-echoues" className="font-medium text-amber-900">
            {failures.length} notification{failures.length > 1 ? 's' : ''} non distribuée
            {failures.length > 1 ? 's' : ''}
          </h2>
          <p className="mt-1 text-sm text-amber-800">
            Ces clients n’ont pas été prévenus. Contactez-les si nécessaire.
          </p>
          <ul className="mt-3 text-sm text-amber-900">
            {failures.map((failure) => (
              <li key={failure.id} className="py-1">
                {failure.appointment
                  ? [
                      failure.appointment.client
                        ? `${failure.appointment.client.firstName ?? ''} ${failure.appointment.client.lastName ?? ''}`.trim()
                        : failure.appointment.guestName,
                      formatDate(failure.appointment.startAt, salon.timezone, 'd MMMM'),
                    ]
                      .filter(Boolean)
                      .join(' — ')
                  : 'Rendez-vous supprimé'}{' '}
                <span className="text-amber-700">
                  ({failure.channel === 'EMAIL' ? 'courriel' : 'SMS'})
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="mt-8">
        <StatsView
          salonId={salonId}
          stats={stats}
          topServices={topServices}
          staff={staff}
          period={{ from: isoFrom, to: isoTo }}
        />
      </div>
    </>
  )
}
