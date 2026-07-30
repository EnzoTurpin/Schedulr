import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { listSalonAuditLog } from '@/features/admin/queries'
import { requireActor } from '@/lib/auth/actor'
import { can } from '@/lib/authz/can'
import { crossSalon } from '@/lib/db/scoped'
import { formatDate } from '@/lib/format'

export const metadata: Metadata = { title: 'Journal du salon' }

/**
 * Journal des actes de configuration d'un salon.
 *
 * Le droit `audit:read_salon` existait, réservé au gérant, sans aucun écran
 * pour l'exercer. Le journal répond aux questions qui se posent après coup :
 * qui a désactivé ce membre, quand ces horaires ont-ils changé.
 */

/** Libellés des actes journalisés. La clé technique n'est pas lisible. */
const ACTION_LABELS: Record<string, string> = {
  'member.invited': 'Invitation envoyée',
  'member.invitation_accepted': 'Invitation acceptée',
  'member.deactivated': 'Membre désactivé',
  'salon.activated': 'Salon réactivé',
  'salon.suspended': 'Salon suspendu',
  'salon.created': 'Salon créé',
}

export default async function SalonAuditPage({
  params,
  searchParams,
}: {
  params: Promise<{ salonId: string }>
  searchParams: Promise<{ page?: string }>
}) {
  const { salonId } = await params
  const actor = await requireActor()

  // Réservé au gérant, contrairement au reste de la configuration.
  if (!can(actor, 'audit:read_salon', { kind: 'salon', salonId })) {
    notFound()
  }

  const query = await searchParams
  const page = Math.max(1, Number(query.page ?? '1') || 1)

  const [salon, { items, total, pageCount }] = await Promise.all([
    crossSalon('journal du salon').salon.findUnique({
      where: { id: salonId },
      select: { name: true, timezone: true },
    }),
    listSalonAuditLog(actor, salonId, { page }),
  ])
  if (!salon) notFound()

  return (
    <>
      <p className="text-sm text-slate-500">
        <Link href={`/pro/${salonId}`} className="underline">
          ← Retour à l’agenda
        </Link>
      </p>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight">Journal du salon</h1>
      <p className="mt-1 text-sm text-slate-600">
        {total} entrée{total > 1 ? 's' : ''} · {salon.name}
      </p>

      <ul className="mt-6 divide-y divide-slate-200">
        {items.map((entry) => (
          <li key={entry.id} className="py-3 text-sm">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="font-medium">
                {ACTION_LABELS[entry.action] ?? entry.action}
              </span>
              <span className="text-slate-500">
                {formatDate(entry.createdAt, salon.timezone, 'd MMM yyyy à HH:mm')}
              </span>
            </div>
            <p className="mt-1 text-slate-600">
              {entry.actor?.email ?? 'Auteur inconnu'}
              <span className="text-slate-400"> · {entry.targetType}</span>
            </p>
          </li>
        ))}
      </ul>

      {items.length === 0 && (
        <p className="mt-6 text-slate-600">
          Aucun acte de configuration n’a encore été enregistré.
        </p>
      )}

      {pageCount > 1 && (
        <nav aria-label="Pagination" className="mt-6 flex justify-center gap-4 text-sm">
          {page > 1 && (
            <Link
              href={{ pathname: `/pro/${salonId}/journal`, query: { page: page - 1 } }}
              className="underline"
            >
              Page précédente
            </Link>
          )}
          <span className="text-slate-500">
            Page {page} sur {pageCount}
          </span>
          {page < pageCount && (
            <Link
              href={{ pathname: `/pro/${salonId}/journal`, query: { page: page + 1 } }}
              className="underline"
            >
              Page suivante
            </Link>
          )}
        </nav>
      )}
    </>
  )
}
