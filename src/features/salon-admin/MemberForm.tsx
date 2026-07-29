'use client'

import type { SalonRole } from '@/generated/prisma'

/**
 * Création et modification d'une fiche de membre.
 *
 * Extrait de `TeamPanel`, devenu trop long une fois les horaires et les congés
 * ajoutés. Le composant ne connaît ni le salon ni les actions serveur : il
 * remonte les valeurs saisies, l'appelant décide quoi en faire.
 */

export type MemberValues = {
  displayName: string
  bio: string | null
  color: string
  role: SalonRole
  isBookable: boolean
}

type Props = {
  /** Nom du membre modifié, ou `null` pour une création. */
  editedName: string | null
  values: MemberValues
  pending: boolean
  onSubmit: (values: MemberValues) => void
  onCancel: () => void
}

export function MemberForm({ editedName, values, pending, onSubmit, onCancel }: Props) {
  return (
    <form
      action={(formData) =>
        onSubmit({
          displayName: String(formData.get('displayName') ?? ''),
          bio: String(formData.get('bio') ?? '') || null,
          color: String(formData.get('color') ?? values.color),
          role: String(formData.get('role') ?? 'STAFF') as SalonRole,
          isBookable: formData.get('isBookable') === 'on',
        })
      }
      className="mt-6 rounded-lg border border-slate-200 p-5"
    >
      <h3 className="font-medium">
        {editedName ? `Modifier « ${editedName} »` : 'Nouveau membre'}
      </h3>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="displayName" className="text-sm font-medium">
            Nom affiché
          </label>
          <input
            id="displayName"
            name="displayName"
            required
            maxLength={80}
            defaultValue={values.displayName}
            aria-describedby="aide-nom"
            className="rounded-md border border-slate-300 px-3 py-2"
          />
          <p id="aide-nom" className="text-xs text-slate-500">
            Visible des clients lors de la réservation.
          </p>
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="role" className="text-sm font-medium">
            Rôle
          </label>
          <select
            id="role"
            name="role"
            defaultValue={values.role}
            className="rounded-md border border-slate-300 px-3 py-2"
          >
            <option value="STAFF">Coiffeur</option>
            <option value="MANAGER">Manager</option>
            <option value="OWNER">Gérant</option>
          </select>
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="color" className="text-sm font-medium">
            Couleur dans l’agenda
          </label>
          <input
            id="color"
            name="color"
            type="color"
            defaultValue={values.color}
            className="h-10 w-20 rounded-md border border-slate-300"
          />
        </div>

        <div className="flex items-center gap-2 pt-6">
          <input
            id="isBookable"
            name="isBookable"
            type="checkbox"
            defaultChecked={values.isBookable}
            className="size-4"
          />
          <label htmlFor="isBookable" className="text-sm">
            Réservable en ligne
          </label>
        </div>
      </div>

      <div className="mt-4 flex flex-col gap-1.5">
        <label htmlFor="bio" className="text-sm font-medium">
          Présentation <span className="text-slate-500">(facultatif)</span>
        </label>
        <textarea
          id="bio"
          name="bio"
          rows={2}
          maxLength={500}
          defaultValue={values.bio ?? ''}
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
          onClick={onCancel}
          className="rounded-md border border-slate-300 px-4 py-2 text-sm"
        >
          Annuler
        </button>
      </div>
    </form>
  )
}
