import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { listUsers } from '@/features/admin/queries'
import { requireActor } from '@/lib/auth/actor'
import { can } from '@/lib/authz/can'
import { formatDate } from '@/lib/format'

export const metadata: Metadata = { title: 'Comptes' }

export default async function AdminUsersPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; q?: string }>
}) {
  const actor = await requireActor()
  if (!can(actor, 'audit:read_platform', { kind: 'platform' })) {
    notFound()
  }

  const query = await searchParams
  const page = Math.max(1, Number(query.page ?? '1') || 1)
  const { items, total, pageCount } = await listUsers(actor, { page, q: query.q })

  return (
    <>
      <form role="search" className="flex gap-3" action="">
        <label htmlFor="q" className="sr-only">
          Rechercher un compte
        </label>
        <input
          id="q"
          name="q"
          type="search"
          defaultValue={query.q ?? ''}
          placeholder="Adresse ou nom"
          className="flex-1 rounded-md border border-slate-300 px-3 py-2"
        />
        <button
          type="submit"
          className="rounded-md border border-slate-300 px-4 py-2 text-sm"
        >
          Rechercher
        </button>
      </form>

      <p aria-live="polite" className="mt-4 text-sm text-slate-500">
        {total} compte{total > 1 ? 's' : ''}
      </p>

      {/* Le tableau défile dans son propre conteneur : sans cela il débordait
          de 49 pixels sur un écran de 375, et c'était la page entière qui
          défilait horizontalement. */}
      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[36rem] text-sm">
          <caption className="sr-only">Comptes de la plateforme</caption>
          <thead>
            <tr className="border-b border-slate-200 text-left text-slate-500">
              <th scope="col" className="py-2">
                Compte
              </th>
              <th scope="col">Rôle</th>
              <th scope="col">Rendez-vous</th>
              <th scope="col">Salons</th>
              <th scope="col">Inscrit le</th>
            </tr>
          </thead>
          <tbody>
            {items.map((user) => (
              <tr key={user.id} className="border-b border-slate-100">
                <td className="py-2">
                  <span className="font-medium">
                    {[user.firstName, user.lastName].filter(Boolean).join(' ') || '—'}
                  </span>
                  <span className="block text-xs text-slate-500">{user.email}</span>
                </td>
                <td>{user.role === 'PLATFORM_ADMIN' ? 'Administrateur' : 'Client'}</td>
                <td>{user._count.appointments}</td>
                <td>{user._count.memberships}</td>
                <td>{formatDate(user.createdAt, 'Europe/Paris', 'd MMM yyyy')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {pageCount > 1 && (
        <nav aria-label="Pagination" className="mt-6 flex justify-center gap-4 text-sm">
          {page > 1 && (
            <Link
              href={{ pathname: '/admin/comptes', query: { ...query, page: page - 1 } }}
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
              href={{ pathname: '/admin/comptes', query: { ...query, page: page + 1 } }}
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
