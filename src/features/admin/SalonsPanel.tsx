'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createSalonAction, setSalonActiveAction } from './actions'

/**
 * Gestion des salons de la plateforme.
 *
 * Un salon créé naît inactif : il n'apparaît ni dans la recherche publique ni
 * dans la réservation tant qu'il n'est pas activé.
 */

type Salon = {
  id: string
  slug: string
  name: string
  city: string
  isActive: boolean
  createdAt: Date
  _count: { members: number; appointments: number }
}

type Props = {
  items: Salon[]
  total: number
  page: number
  pageCount: number
  query: string
}

export function SalonsPanel({ items, total, page, pageCount, query }: Props) {
  const router = useRouter()
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function run(
    call: () => Promise<{ ok: boolean; error?: string }>,
    onDone?: () => void,
  ) {
    setError(null)
    startTransition(async () => {
      const result = await call()
      if (!result.ok) {
        setError(result.error ?? 'L’opération a échoué.')
        return
      }
      onDone?.()
      router.refresh()
    })
  }

  function toggle(salon: Salon) {
    // Une suspension retire le salon de la recherche : on demande confirmation.
    if (salon.isActive) {
      const reason = window.prompt(
        `Suspendre « ${salon.name} » ? Le salon disparaît de la recherche et ne prend plus de rendez-vous.\n\nMotif (facultatif) :`,
      )
      // `null` = annulation ; une chaîne vide reste une confirmation.
      if (reason === null) return
      run(() =>
        setSalonActiveAction({
          salonId: salon.id,
          isActive: false,
          reason: reason || undefined,
        }),
      )
      return
    }
    run(() => setSalonActiveAction({ salonId: salon.id, isActive: true }))
  }

  return (
    <>
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <form role="search" className="flex flex-1 gap-3" action="">
          <label htmlFor="q" className="sr-only">
            Rechercher un salon
          </label>
          <input
            id="q"
            name="q"
            type="search"
            defaultValue={query}
            placeholder="Nom, ville ou adresse"
            className="flex-1 rounded-md border border-slate-300 px-3 py-2"
          />
          <button
            type="submit"
            className="rounded-md border border-slate-300 px-4 py-2 text-sm"
          >
            Rechercher
          </button>
        </form>

        <button
          type="button"
          onClick={() => setCreating((current) => !current)}
          className="bg-brand-600 hover:bg-brand-700 rounded-md px-4 py-2 text-sm font-medium text-white"
        >
          Créer un salon
        </button>
      </div>

      {error && (
        <p
          role="alert"
          className="mt-4 rounded-md bg-red-50 px-4 py-3 text-sm text-red-800"
        >
          {error}
        </p>
      )}

      {creating && (
        <form
          action={(formData) =>
            run(
              () =>
                createSalonAction({
                  slug: String(formData.get('slug') ?? ''),
                  name: String(formData.get('name') ?? ''),
                  address: String(formData.get('address') ?? ''),
                  city: String(formData.get('city') ?? ''),
                  postalCode: String(formData.get('postalCode') ?? ''),
                  ownerEmail: String(formData.get('ownerEmail') ?? ''),
                  ownerDisplayName: String(formData.get('ownerDisplayName') ?? ''),
                }),
              () => setCreating(false),
            )
          }
          className="mt-6 rounded-lg border border-slate-200 p-5"
        >
          <h2 className="font-medium">Nouveau salon</h2>
          <p className="mt-1 text-sm text-slate-600">
            Le salon est créé inactif. Le compte du gérant doit déjà exister.
          </p>

          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="name" className="text-sm font-medium">
                Nom
              </label>
              <input
                id="name"
                name="name"
                required
                maxLength={120}
                className="rounded-md border border-slate-300 px-3 py-2"
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <label htmlFor="slug" className="text-sm font-medium">
                Adresse publique
              </label>
              <input
                id="slug"
                name="slug"
                required
                pattern="[a-z0-9\-]+"
                maxLength={60}
                aria-describedby="aide-slug"
                className="rounded-md border border-slate-300 px-3 py-2"
              />
              <p id="aide-slug" className="text-xs text-slate-500">
                Minuscules, chiffres et tirets. Apparaît dans l’URL du salon.
              </p>
            </div>

            <div className="flex flex-col gap-1.5 sm:col-span-2">
              <label htmlFor="address" className="text-sm font-medium">
                Adresse
              </label>
              <input
                id="address"
                name="address"
                required
                maxLength={200}
                className="rounded-md border border-slate-300 px-3 py-2"
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <label htmlFor="postalCode" className="text-sm font-medium">
                Code postal
              </label>
              <input
                id="postalCode"
                name="postalCode"
                required
                maxLength={20}
                className="rounded-md border border-slate-300 px-3 py-2"
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <label htmlFor="city" className="text-sm font-medium">
                Ville
              </label>
              <input
                id="city"
                name="city"
                required
                maxLength={100}
                className="rounded-md border border-slate-300 px-3 py-2"
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <label htmlFor="ownerEmail" className="text-sm font-medium">
                Adresse du gérant
              </label>
              <input
                id="ownerEmail"
                name="ownerEmail"
                type="email"
                required
                className="rounded-md border border-slate-300 px-3 py-2"
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <label htmlFor="ownerDisplayName" className="text-sm font-medium">
                Nom affiché du gérant
              </label>
              <input
                id="ownerDisplayName"
                name="ownerDisplayName"
                required
                maxLength={80}
                className="rounded-md border border-slate-300 px-3 py-2"
              />
            </div>
          </div>

          <div className="mt-5 flex gap-3">
            <button
              type="submit"
              disabled={pending}
              className="bg-brand-600 hover:bg-brand-700 rounded-md px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              {pending ? 'Création…' : 'Créer'}
            </button>
            <button
              type="button"
              onClick={() => setCreating(false)}
              className="rounded-md border border-slate-300 px-4 py-2 text-sm"
            >
              Annuler
            </button>
          </div>
        </form>
      )}

      <p aria-live="polite" className="mt-6 text-sm text-slate-500">
        {total} salon{total > 1 ? 's' : ''}
      </p>

      <table className="mt-4 w-full text-sm">
        <caption className="sr-only">Salons de la plateforme</caption>
        <thead>
          <tr className="border-b border-slate-200 text-left text-slate-500">
            <th scope="col" className="py-2">
              Salon
            </th>
            <th scope="col">Équipe</th>
            <th scope="col">Rendez-vous</th>
            <th scope="col">État</th>
            <th scope="col">
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {items.map((salon) => (
            <tr key={salon.id} className="border-b border-slate-100">
              <td className="py-3">
                <span className="font-medium">{salon.name}</span>
                <span className="block text-xs text-slate-500">
                  {salon.city} · /{salon.slug}
                </span>
              </td>
              <td>{salon._count.members}</td>
              <td>{salon._count.appointments}</td>
              <td>
                <span className={salon.isActive ? 'text-emerald-700' : 'text-slate-500'}>
                  {salon.isActive ? 'Actif' : 'Suspendu'}
                </span>
              </td>
              <td className="text-right">
                <button
                  type="button"
                  onClick={() => toggle(salon)}
                  disabled={pending}
                  className="underline disabled:opacity-50"
                >
                  {salon.isActive ? 'Suspendre' : 'Activer'}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {items.length === 0 && <p className="mt-6 text-slate-600">Aucun salon.</p>}

      {pageCount > 1 && (
        <nav aria-label="Pagination" className="mt-6 flex justify-center gap-4 text-sm">
          {page > 1 && (
            <Link
              href={{ pathname: '/admin/salons', query: { q: query, page: page - 1 } }}
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
              href={{ pathname: '/admin/salons', query: { q: query, page: page + 1 } }}
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
