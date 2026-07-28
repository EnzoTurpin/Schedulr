import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { listAuditLog } from '@/features/admin/queries'
import { requireActor } from '@/lib/auth/actor'
import { can } from '@/lib/authz/can'
import { formatDate } from '@/lib/format'

export const metadata: Metadata = { title: 'Journal d’audit' }

export default async function AdminAuditPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>
}) {
  const actor = await requireActor()
  if (!can(actor, 'audit:read_platform', { kind: 'platform' })) {
    notFound()
  }

  const query = await searchParams
  const page = Math.max(1, Number(query.page ?? '1') || 1)
  const { items, total, pageCount } = await listAuditLog(actor, { page })

  return (
    <>
      <p className="text-sm text-slate-500">
        {total} entrée{total > 1 ? 's' : ''}
      </p>

      <ul className="mt-4 divide-y divide-slate-200">
        {items.map((entry) => (
          <li key={entry.id} className="py-3 text-sm">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="font-medium">{entry.action}</span>
              <span className="text-slate-500">
                {formatDate(entry.createdAt, 'Europe/Paris', 'd MMM yyyy à HH:mm')}
              </span>
            </div>
            <p className="mt-1 text-slate-600">
              {entry.salon?.name ?? 'Plateforme'}
              {entry.actor?.email && <span> · {entry.actor.email}</span>}
              <span className="text-slate-400"> · {entry.targetType}</span>
            </p>
          </li>
        ))}
      </ul>

      {items.length === 0 && <p className="mt-4 text-slate-600">Aucune entrée.</p>}

      {pageCount > 1 && (
        <nav aria-label="Pagination" className="mt-6 flex justify-center gap-4 text-sm">
          {page > 1 && (
            <Link
              href={{ pathname: '/admin/audit', query: { page: page - 1 } }}
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
              href={{ pathname: '/admin/audit', query: { page: page + 1 } }}
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
