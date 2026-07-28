import type { Metadata } from 'next'
import Link from 'next/link'
import { searchSalons } from '@/features/salon/queries'

export const metadata: Metadata = {
  title: 'Trouver un salon de coiffure',
  description:
    'Réservez votre rendez-vous en ligne dans un salon de coiffure près de chez vous, 24 h/24.',
}

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string }>
}) {
  const params = await searchParams
  const page = Math.max(1, Number(params.page ?? '1') || 1)
  const { items, total, pageCount } = await searchSalons({ q: params.q, page })

  return (
    <main id="contenu" className="mx-auto max-w-4xl px-6 py-12">
      <h1 className="text-3xl font-semibold tracking-tight">
        Réservez votre coiffeur en ligne
      </h1>
      <p className="mt-3 text-slate-600">
        Choisissez votre prestation, votre coiffeur et votre créneau. Sans appel
        téléphonique.
      </p>

      {/* Formulaire GET : la recherche reste dans l'URL, donc partageable et
          indexable. */}
      <form role="search" className="mt-8 flex gap-3" action="/">
        <div className="flex-1">
          <label htmlFor="q" className="sr-only">
            Ville ou nom du salon
          </label>
          <input
            id="q"
            name="q"
            type="search"
            defaultValue={params.q ?? ''}
            placeholder="Ville ou nom du salon"
            className="w-full rounded-md border border-slate-300 px-4 py-2.5"
          />
        </div>
        <button
          type="submit"
          className="bg-brand-600 hover:bg-brand-700 rounded-md px-5 py-2.5 font-medium text-white"
        >
          Rechercher
        </button>
      </form>

      <p aria-live="polite" className="mt-6 text-sm text-slate-500">
        {total === 0
          ? 'Aucun salon ne correspond à votre recherche.'
          : `${total} salon${total > 1 ? 's' : ''} disponible${total > 1 ? 's' : ''}`}
      </p>

      <ul className="mt-4 grid gap-4 sm:grid-cols-2">
        {items.map((salon) => (
          <li key={salon.id}>
            <Link
              href={`/salon/${salon.slug}`}
              className="hover:border-brand-400 block h-full rounded-lg border border-slate-200 p-5 transition-colors"
            >
              <h2 className="font-semibold">{salon.name}</h2>
              <p className="mt-1 text-sm text-slate-600">
                {salon.address}, {salon.postalCode} {salon.city}
              </p>
              {salon.description && (
                <p className="mt-2 line-clamp-2 text-sm text-slate-500">
                  {salon.description}
                </p>
              )}
              <p className="mt-3 text-sm text-slate-500">
                {salon._count.members} coiffeur
                {salon._count.members > 1 ? 's' : ''}
              </p>
            </Link>
          </li>
        ))}
      </ul>

      {pageCount > 1 && (
        <nav aria-label="Pagination" className="mt-8 flex justify-center gap-4">
          {page > 1 && (
            <Link
              href={{ pathname: '/', query: { ...params, page: page - 1 } }}
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
              href={{ pathname: '/', query: { ...params, page: page + 1 } }}
              className="underline"
            >
              Page suivante
            </Link>
          )}
        </nav>
      )}
    </main>
  )
}
