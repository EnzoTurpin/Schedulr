'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { formatDuration, formatPrice } from '@/lib/format'
import { setServiceOverrideAction } from './actions'

/**
 * Durée et prix propres à un coiffeur.
 *
 * Une coloration prend plus de temps chez un apprenti, et le tarif peut suivre.
 * Le moteur de disponibilité honorait déjà cette durée : seule la saisie
 * manquait, `setServiceOverride` n'ayant ni action serveur ni écran.
 *
 * Un champ vide rétablit la valeur du catalogue. C'est ce qui distingue
 * « aucune surcharge » de « surcharge à zéro », qu'un simple nombre
 * confondrait.
 */

type Service = { id: string; name: string; durationMin: number; priceCents: number }

type Assignment = {
  serviceId: string
  durationMin: number | null
  priceCents: number | null
}

type Props = {
  salonId: string
  memberId: string
  memberName: string
  services: Service[]
  assignments: Assignment[]
}

export function ServiceOverrides({
  salonId,
  memberId,
  memberName,
  services,
  assignments,
}: Props) {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  const assigned = assignments
    .map((assignment) => ({
      assignment,
      service: services.find((service) => service.id === assignment.serviceId),
    }))
    .filter((row): row is { assignment: Assignment; service: Service } => !!row.service)

  if (assigned.length === 0) {
    return (
      <p className="text-sm text-slate-600">
        Affectez d’abord des prestations à {memberName}.
      </p>
    )
  }

  function save(serviceId: string, formData: FormData) {
    setError(null)
    setSaved(null)

    const read = (name: string) => {
      const raw = String(formData.get(name) ?? '').trim()
      return raw === '' ? null : Number(raw)
    }

    startTransition(async () => {
      const price = read('priceEuros')
      const result = await setServiceOverrideAction({
        salonId,
        memberId,
        serviceId,
        durationMin: read('durationMin'),
        // Le formulaire saisit des euros, la base stocke des centimes.
        priceCents: price === null ? null : Math.round(price * 100),
      })
      if (!result.ok) {
        setError(result.error)
        return
      }
      setSaved(serviceId)
      router.refresh()
    })
  }

  return (
    <div>
      {error && (
        <p role="alert" className="mb-3 text-sm text-red-800">
          {error}
        </p>
      )}

      <ul className="divide-y divide-slate-200">
        {assigned.map(({ assignment, service }) => (
          <li key={service.id} className="py-3">
            <form
              action={(formData) => save(service.id, formData)}
              className="flex flex-wrap items-end gap-3"
            >
              <span className="min-w-32 flex-1 text-sm font-medium">{service.name}</span>

              <div className="flex flex-col gap-1">
                <label
                  htmlFor={`duree-${memberId}-${service.id}`}
                  className="text-xs text-slate-500"
                >
                  Durée ({formatDuration(service.durationMin)})
                </label>
                <input
                  id={`duree-${memberId}-${service.id}`}
                  name="durationMin"
                  type="number"
                  min={5}
                  max={600}
                  step={5}
                  defaultValue={assignment.durationMin ?? ''}
                  placeholder="catalogue"
                  className="w-28 rounded-md border border-slate-300 px-2 py-1 text-sm"
                />
              </div>

              <div className="flex flex-col gap-1">
                <label
                  htmlFor={`prix-${memberId}-${service.id}`}
                  className="text-xs text-slate-500"
                >
                  Prix ({formatPrice(service.priceCents)})
                </label>
                <input
                  id={`prix-${memberId}-${service.id}`}
                  name="priceEuros"
                  type="number"
                  min={0}
                  step={0.5}
                  defaultValue={
                    assignment.priceCents === null ? '' : assignment.priceCents / 100
                  }
                  placeholder="catalogue"
                  className="w-28 rounded-md border border-slate-300 px-2 py-1 text-sm"
                />
              </div>

              <button
                type="submit"
                disabled={pending}
                className="rounded-md border border-slate-300 px-3 py-1.5 text-sm disabled:opacity-50"
              >
                Appliquer
              </button>

              {saved === service.id && (
                <span role="status" className="text-sm text-emerald-700">
                  Enregistré.
                </span>
              )}
            </form>
          </li>
        ))}
      </ul>

      <p className="mt-3 text-xs text-slate-500">
        Laissez un champ vide pour reprendre la valeur du catalogue.
      </p>
    </div>
  )
}
