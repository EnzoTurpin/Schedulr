import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { getPlatformStats } from '@/features/admin/queries'
import { requireActor } from '@/lib/auth/actor'
import { can } from '@/lib/authz/can'

export const metadata: Metadata = { title: 'Vue d’ensemble' }

export default async function AdminHomePage() {
  const actor = await requireActor()

  if (!can(actor, 'audit:read_platform', { kind: 'platform' })) {
    notFound()
  }

  const stats = await getPlatformStats(actor)

  const tiles = [
    { label: 'Salons', value: stats.salons, hint: `${stats.activeSalons} actifs` },
    { label: 'Comptes', value: stats.users, hint: 'Hors comptes anonymisés' },
    { label: 'Rendez-vous', value: stats.appointments, hint: 'Depuis l’origine' },
    { label: 'Sur 30 jours', value: stats.recentAppointments, hint: 'Rendez-vous créés' },
  ]

  return (
    <>
      <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {tiles.map((tile) => (
          <div key={tile.label} className="rounded-lg border border-slate-200 p-5">
            <dt className="text-sm text-slate-500">{tile.label}</dt>
            {/* Le texte d'aide vit dans le <dd> : un <div> enfant de <dl>
                n'admet que <dt> et <dd>. */}
            <dd className="mt-1">
              <span className="block text-2xl font-semibold tracking-tight">
                {tile.value}
              </span>
              <span className="mt-1 block text-xs text-slate-500">{tile.hint}</span>
            </dd>
          </div>
        ))}
      </dl>

      {stats.failedNotifications > 0 && (
        <p className="mt-8 rounded-lg border border-amber-300 bg-amber-50 px-5 py-4 text-sm text-amber-900">
          {stats.failedNotifications} notification
          {stats.failedNotifications > 1 ? 's' : ''} en échec définitif sur l’ensemble de
          la plateforme.
        </p>
      )}
    </>
  )
}
