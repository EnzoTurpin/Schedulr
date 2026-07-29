import type { Metadata } from 'next'
import Link from 'next/link'
import { CancelButton } from '@/features/booking/CancelButton'
import {
  canClientCancel,
  listPastAppointments,
  listUpcomingAppointments,
  type ClientAppointment,
} from '@/features/booking/queries'
import { ConsentToggle } from '@/features/notifications/ConsentToggle'
import { DataPanel } from '@/features/privacy/DataPanel'
import { getConsents } from '@/features/notifications/consent'
import { requireActor } from '@/lib/auth/actor'
import { prisma } from '@/lib/db/client'
import { formatDateTimeLong, formatPrice } from '@/lib/format'

export const metadata: Metadata = { title: 'Mes rendez-vous' }

const STATUS_LABELS: Record<string, string> = {
  PENDING: 'En attente',
  CONFIRMED: 'Confirmé',
  DONE: 'Honoré',
  NO_SHOW: 'Non honoré',
  CANCELLED: 'Annulé',
}

function AppointmentCard({
  appointment,
  cancellable,
}: {
  appointment: ClientAppointment
  cancellable: boolean
}) {
  const total = appointment.items.reduce((sum, item) => sum + item.priceCents, 0)

  return (
    <li className="rounded-lg border border-slate-200 p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-semibold">{appointment.salon.name}</h3>
        {/* L'état est porté par le texte, pas seulement par la couleur. */}
        <span className="rounded bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
          {STATUS_LABELS[appointment.status] ?? appointment.status}
        </span>
      </div>

      <p className="mt-1 text-sm text-slate-600">
        {appointment.salon.address}, {appointment.salon.city}
      </p>

      <p className="mt-3 font-medium">
        {formatDateTimeLong(appointment.startAt, appointment.salon.timezone)}
      </p>
      <p className="text-sm text-slate-600">avec {appointment.member.displayName}</p>

      <ul className="mt-3 text-sm text-slate-700">
        {appointment.items.map((item, index) => (
          <li key={index} className="flex justify-between">
            <span>{item.nameSnapshot}</span>
            <span>{formatPrice(item.priceCents)}</span>
          </li>
        ))}
      </ul>
      <p className="mt-2 flex justify-between border-t border-slate-200 pt-2 text-sm font-medium">
        <span>Total</span>
        <span>{formatPrice(total)}</span>
      </p>

      {cancellable && (
        <div className="mt-4">
          <CancelButton appointmentId={appointment.id} />
        </div>
      )}
    </li>
  )
}

export default async function ClientAreaPage({
  searchParams,
}: {
  searchParams: Promise<{ reservation?: string; adresse?: string }>
}) {
  const actor = await requireActor()
  const params = await searchParams
  const now = new Date()

  const [upcoming, past, consents, profile] = await Promise.all([
    listUpcomingAppointments(actor, now),
    listPastAppointments(actor, { now }),
    getConsents(actor.userId),
    prisma.user.findUnique({
      where: { id: actor.userId },
      select: { phone: true },
    }),
  ])

  return (
    <>
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">Mes rendez-vous</h1>
        <Link href="/mon-compte/profil" className="text-sm underline">
          Mon profil
        </Link>
      </div>

      {params.adresse === 'confirmee' && (
        <p
          role="status"
          className="mt-4 rounded-md bg-emerald-50 px-4 py-3 text-sm text-emerald-800"
        >
          Votre adresse est confirmée. Vous recevrez désormais vos confirmations et
          rappels.
        </p>
      )}
      {params.adresse === 'expiree' && (
        <p
          role="alert"
          className="mt-4 rounded-md bg-red-50 px-4 py-3 text-sm text-red-800"
        >
          Ce lien de confirmation n’est plus valable. Demandez-en un nouveau depuis votre
          profil.
        </p>
      )}

      {params.reservation && (
        <p
          role="status"
          className="mt-4 rounded-md bg-emerald-50 px-4 py-3 text-sm text-emerald-800"
        >
          Votre rendez-vous est confirmé. Vous le retrouverez ci-dessous.
        </p>
      )}

      <section aria-labelledby="a-venir" className="mt-8">
        <h2 id="a-venir" className="text-lg font-semibold">
          À venir
        </h2>
        {upcoming.length === 0 ? (
          <p className="mt-3 text-slate-600">
            Aucun rendez-vous à venir.{' '}
            <Link href="/" className="text-brand-700 underline">
              Trouver un salon
            </Link>
          </p>
        ) : (
          <ul className="mt-4 grid gap-4">
            {upcoming.map((appointment) => (
              <AppointmentCard
                key={appointment.id}
                appointment={appointment}
                cancellable={canClientCancel(appointment, now)}
              />
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="notifications" className="mt-12">
        <h2 id="notifications" className="text-lg font-semibold">
          Notifications
        </h2>
        <p className="mt-1 text-sm text-slate-600">
          Les confirmations et rappels par courriel sont toujours envoyés.
        </p>
        <div className="mt-4">
          <ConsentToggle
            granted={consents.TRANSACTIONAL_SMS}
            hasPhone={Boolean(profile?.phone)}
          />
        </div>
      </section>

      <section aria-labelledby="mes-donnees" className="mt-12">
        <h2 id="mes-donnees" className="text-lg font-semibold">
          Mes données
        </h2>
        <div className="mt-4">
          <DataPanel />
        </div>
      </section>

      {past.items.length > 0 && (
        <section aria-labelledby="historique" className="mt-12">
          <h2 id="historique" className="text-lg font-semibold">
            Historique
          </h2>
          <ul className="mt-4 grid gap-4">
            {past.items.map((appointment) => (
              <AppointmentCard
                key={appointment.id}
                appointment={appointment}
                cancellable={false}
              />
            ))}
          </ul>
          {past.hasMore && (
            <p className="mt-4 text-sm text-slate-500">
              {past.total} rendez-vous au total.
            </p>
          )}
        </section>
      )}
    </>
  )
}
