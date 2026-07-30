'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { formatDuration, formatPrice } from '@/lib/format'
import {
  createCategoryAction,
  deleteCategoryAction,
  renameCategoryAction,
  saveServiceAction,
  toggleServiceAction,
} from './actions'

/**
 * Gestion du catalogue : catégories et prestations.
 *
 * Une prestation retirée n'est pas supprimée : elle disparaît de la
 * réservation en ligne mais reste rattachée aux rendez-vous passés.
 */

type Category = { id: string; name: string; position: number }
type Service = {
  id: string
  name: string
  description: string | null
  categoryId: string | null
  durationMin: number
  bufferBeforeMin: number
  bufferAfterMin: number
  priceCents: number
  isActive: boolean
}

type Props = { salonId: string; categories: Category[]; services: Service[] }

const EMPTY: Omit<Service, 'id' | 'isActive'> = {
  name: '',
  description: null,
  categoryId: null,
  durationMin: 30,
  bufferBeforeMin: 0,
  bufferAfterMin: 0,
  priceCents: 0,
}

export function ServicesPanel({ salonId, categories, services }: Props) {
  const router = useRouter()
  const [editing, setEditing] = useState<Service | 'new' | null>(null)
  const [renaming, setRenaming] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  const draft = editing === 'new' ? { ...EMPTY, id: '', isActive: true } : editing

  function run(
    call: () => Promise<{ ok: boolean; error?: string }>,
    onDone?: () => void,
  ) {
    setError(null)
    startTransition(async () => {
      const result = await call()
      if (!result.ok) {
        setError(result.error ?? 'L’enregistrement a échoué.')
        return
      }
      onDone?.()
      router.refresh()
    })
  }

  function submit(formData: FormData) {
    run(
      () =>
        saveServiceAction({
          salonId,
          serviceId: editing !== 'new' && editing ? editing.id : undefined,
          name: String(formData.get('name') ?? ''),
          description: String(formData.get('description') ?? '') || undefined,
          categoryId: String(formData.get('categoryId') ?? '') || null,
          // Les champs numériques arrivent en texte : la conversion est faite
          // ici, la validation côté serveur.
          durationMin: Number(formData.get('durationMin')),
          bufferBeforeMin: Number(formData.get('bufferBeforeMin')),
          bufferAfterMin: Number(formData.get('bufferAfterMin')),
          priceCents: Math.round(Number(formData.get('price')) * 100),
        }),
      () => setEditing(null),
    )
  }

  return (
    <section aria-labelledby="titre-catalogue">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 id="titre-catalogue" className="text-lg font-semibold">
          Prestations
        </h2>
        <button
          type="button"
          onClick={() => setEditing('new')}
          className="bg-brand-600 hover:bg-brand-700 rounded-md px-4 py-2 text-sm font-medium text-white"
        >
          Ajouter une prestation
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

      <form
        action={(formData) =>
          run(
            () =>
              createCategoryAction({
                salonId,
                name: String(formData.get('categoryName') ?? ''),
              }),
            () => undefined,
          )
        }
        className="mt-6 flex flex-wrap items-end gap-3"
      >
        <div className="flex flex-col gap-1.5">
          <label htmlFor="categoryName" className="text-sm font-medium">
            Nouvelle catégorie
          </label>
          <input
            id="categoryName"
            name="categoryName"
            required
            maxLength={80}
            className="rounded-md border border-slate-300 px-3 py-2"
          />
        </div>
        <button
          type="submit"
          disabled={pending}
          className="rounded-md border border-slate-300 px-4 py-2 text-sm disabled:opacity-50"
        >
          Créer
        </button>
      </form>

      {categories.length > 0 && (
        <ul className="mt-4 flex flex-wrap gap-2">
          {categories.map((category) => (
            <li
              key={category.id}
              className="flex items-center gap-2 rounded-full bg-slate-100 py-1 pr-2 pl-3 text-sm"
            >
              {renaming === category.id ? (
                <form
                  action={(formData) =>
                    run(
                      () =>
                        renameCategoryAction({
                          salonId,
                          categoryId: category.id,
                          name: String(formData.get('name') ?? ''),
                        }),
                      () => setRenaming(null),
                    )
                  }
                  className="flex items-center gap-2"
                >
                  <label htmlFor={`categorie-${category.id}`} className="sr-only">
                    Nouveau nom de la catégorie {category.name}
                  </label>
                  <input
                    id={`categorie-${category.id}`}
                    name="name"
                    required
                    maxLength={80}
                    defaultValue={category.name}
                    className="w-40 rounded border border-slate-300 px-2 py-0.5 text-sm"
                  />
                  <button type="submit" disabled={pending} className="underline">
                    Enregistrer
                  </button>
                  <button
                    type="button"
                    onClick={() => setRenaming(null)}
                    className="text-slate-500"
                  >
                    Annuler
                  </button>
                </form>
              ) : (
                <>
                  {category.name}
                  <button
                    type="button"
                    onClick={() => setRenaming(category.id)}
                    aria-label={`Renommer la catégorie ${category.name}`}
                    className="text-slate-500 hover:text-slate-900"
                  >
                    ✎
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      run(() =>
                        deleteCategoryAction({ salonId, categoryId: category.id }),
                      )
                    }
                    aria-label={`Supprimer la catégorie ${category.name}`}
                    className="text-slate-500 hover:text-red-700"
                  >
                    ×
                  </button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}

      {draft && (
        <form action={submit} className="mt-6 rounded-lg border border-slate-200 p-5">
          <h3 className="font-medium">
            {editing === 'new' ? 'Nouvelle prestation' : `Modifier « ${draft.name} »`}
          </h3>

          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="name" className="text-sm font-medium">
                Nom
              </label>
              <input
                id="name"
                name="name"
                required
                defaultValue={draft.name}
                maxLength={120}
                className="rounded-md border border-slate-300 px-3 py-2"
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <label htmlFor="categoryId" className="text-sm font-medium">
                Catégorie
              </label>
              <select
                id="categoryId"
                name="categoryId"
                defaultValue={draft.categoryId ?? ''}
                className="rounded-md border border-slate-300 px-3 py-2"
              >
                <option value="">Sans catégorie</option>
                {categories.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex flex-col gap-1.5">
              <label htmlFor="durationMin" className="text-sm font-medium">
                Durée (minutes)
              </label>
              <input
                id="durationMin"
                name="durationMin"
                type="number"
                min={5}
                max={600}
                step={5}
                required
                defaultValue={draft.durationMin}
                className="rounded-md border border-slate-300 px-3 py-2"
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <label htmlFor="price" className="text-sm font-medium">
                Prix (€)
              </label>
              <input
                id="price"
                name="price"
                type="number"
                min={0}
                step="0.01"
                required
                defaultValue={(draft.priceCents / 100).toFixed(2)}
                className="rounded-md border border-slate-300 px-3 py-2"
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <label htmlFor="bufferBeforeMin" className="text-sm font-medium">
                Préparation avant (min)
              </label>
              <input
                id="bufferBeforeMin"
                name="bufferBeforeMin"
                type="number"
                min={0}
                max={120}
                step={5}
                defaultValue={draft.bufferBeforeMin}
                aria-describedby="aide-marges"
                className="rounded-md border border-slate-300 px-3 py-2"
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <label htmlFor="bufferAfterMin" className="text-sm font-medium">
                Remise en état après (min)
              </label>
              <input
                id="bufferAfterMin"
                name="bufferAfterMin"
                type="number"
                min={0}
                max={120}
                step={5}
                defaultValue={draft.bufferAfterMin}
                aria-describedby="aide-marges"
                className="rounded-md border border-slate-300 px-3 py-2"
              />
            </div>
          </div>

          <p id="aide-marges" className="mt-2 text-xs text-slate-500">
            Les marges bloquent l’agenda sans être facturées au client.
          </p>

          <div className="mt-4 flex flex-col gap-1.5">
            <label htmlFor="description" className="text-sm font-medium">
              Description <span className="text-slate-500">(facultatif)</span>
            </label>
            <textarea
              id="description"
              name="description"
              rows={2}
              maxLength={500}
              defaultValue={draft.description ?? ''}
              className="rounded-md border border-slate-300 px-3 py-2"
            />
          </div>

          <div className="mt-5 flex gap-3">
            <button
              type="submit"
              disabled={pending}
              className="bg-brand-600 hover:bg-brand-700 rounded-md px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              {pending ? 'Enregistrement…' : 'Enregistrer'}
            </button>
            <button
              type="button"
              onClick={() => setEditing(null)}
              className="rounded-md border border-slate-300 px-4 py-2 text-sm"
            >
              Annuler
            </button>
          </div>
        </form>
      )}

      <table className="mt-6 w-full text-sm">
        <caption className="sr-only">Prestations du salon</caption>
        <thead>
          <tr className="border-b border-slate-200 text-left text-slate-500">
            <th scope="col" className="py-2">
              Prestation
            </th>
            <th scope="col">Durée</th>
            <th scope="col">Prix</th>
            <th scope="col">État</th>
            <th scope="col">
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {services.map((service) => (
            <tr key={service.id} className="border-b border-slate-100">
              <td className="py-3">
                <span className="font-medium">{service.name}</span>
                {service.categoryId && (
                  <span className="block text-xs text-slate-500">
                    {categories.find((c) => c.id === service.categoryId)?.name}
                  </span>
                )}
              </td>
              <td>{formatDuration(service.durationMin)}</td>
              <td>{formatPrice(service.priceCents)}</td>
              <td>
                <span
                  className={
                    service.isActive ? 'text-emerald-700' : 'text-slate-500 italic'
                  }
                >
                  {service.isActive ? 'Proposée' : 'Retirée'}
                </span>
              </td>
              <td className="text-right">
                <button
                  type="button"
                  onClick={() => setEditing(service)}
                  className="mr-3 underline"
                >
                  Modifier
                </button>
                <button
                  type="button"
                  onClick={() =>
                    run(() =>
                      toggleServiceAction({
                        salonId,
                        serviceId: service.id,
                        isActive: !service.isActive,
                      }),
                    )
                  }
                  className="underline"
                >
                  {service.isActive ? 'Retirer' : 'Remettre'}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {services.length === 0 && (
        <p className="mt-6 text-slate-600">
          Aucune prestation. Ajoutez-en une pour ouvrir la réservation en ligne.
        </p>
      )}
    </section>
  )
}
