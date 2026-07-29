'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { saveBookingSettingsAction, saveProfileAction } from './actions'
import { ALLOWED_SLOT_STEPS } from './constants'

/**
 * Fiche du salon et paramètres de réservation.
 *
 * Les paramètres gouvernent directement le calcul des créneaux : les modifier
 * change ce que voient les clients dès l'enregistrement.
 */

type Salon = {
  id: string
  name: string
  description: string | null
  address: string
  city: string
  postalCode: string
  phone: string | null
  email: string | null
  bookingLeadTimeMin: number
  bookingHorizonDays: number
  slotStepMin: number
  cancellationDeadlineHours: number
  smsMonthlyQuota: number
}

export function SettingsPanel({ salon }: { salon: Salon }) {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function run(call: () => Promise<{ ok: boolean; error?: string }>, label: string) {
    setError(null)
    setSaved(null)
    startTransition(async () => {
      const result = await call()
      if (!result.ok) {
        setError(result.error ?? 'L’enregistrement a échoué.')
        return
      }
      setSaved(label)
      router.refresh()
    })
  }

  return (
    <div className="grid gap-12">
      {error && (
        <p role="alert" className="rounded-md bg-red-50 px-4 py-3 text-sm text-red-800">
          {error}
        </p>
      )}
      {saved && (
        <p
          role="status"
          className="rounded-md bg-emerald-50 px-4 py-3 text-sm text-emerald-800"
        >
          {saved}
        </p>
      )}

      <section aria-labelledby="titre-fiche">
        <h2 id="titre-fiche" className="text-lg font-semibold">
          Fiche du salon
        </h2>
        <p className="mt-1 text-sm text-slate-600">
          Ces informations apparaissent sur votre page publique.
        </p>

        <form
          action={(formData) =>
            run(
              () =>
                saveProfileAction({
                  salonId: salon.id,
                  name: String(formData.get('name') ?? ''),
                  description: String(formData.get('description') ?? '') || undefined,
                  address: String(formData.get('address') ?? ''),
                  city: String(formData.get('city') ?? ''),
                  postalCode: String(formData.get('postalCode') ?? ''),
                  phone: String(formData.get('phone') ?? '') || undefined,
                  email: String(formData.get('email') ?? '') || undefined,
                }),
              'Fiche enregistrée.',
            )
          }
          className="mt-5"
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5 sm:col-span-2">
              <label htmlFor="name" className="text-sm font-medium">
                Nom du salon
              </label>
              <input
                id="name"
                name="name"
                required
                maxLength={120}
                defaultValue={salon.name}
                className="rounded-md border border-slate-300 px-3 py-2"
              />
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
                defaultValue={salon.address}
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
                defaultValue={salon.postalCode}
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
                defaultValue={salon.city}
                className="rounded-md border border-slate-300 px-3 py-2"
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <label htmlFor="phone" className="text-sm font-medium">
                Téléphone
              </label>
              <input
                id="phone"
                name="phone"
                type="tel"
                maxLength={30}
                defaultValue={salon.phone ?? ''}
                className="rounded-md border border-slate-300 px-3 py-2"
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <label htmlFor="email" className="text-sm font-medium">
                Adresse électronique
              </label>
              <input
                id="email"
                name="email"
                type="email"
                maxLength={200}
                defaultValue={salon.email ?? ''}
                className="rounded-md border border-slate-300 px-3 py-2"
              />
            </div>

            <div className="flex flex-col gap-1.5 sm:col-span-2">
              <label htmlFor="description" className="text-sm font-medium">
                Description
              </label>
              <textarea
                id="description"
                name="description"
                rows={3}
                maxLength={2000}
                defaultValue={salon.description ?? ''}
                className="rounded-md border border-slate-300 px-3 py-2"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={pending}
            className="bg-brand-600 hover:bg-brand-700 mt-5 rounded-md px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            Enregistrer la fiche
          </button>
        </form>
      </section>

      <section aria-labelledby="titre-reservation">
        <h2 id="titre-reservation" className="text-lg font-semibold">
          Règles de réservation
        </h2>
        <p className="mt-1 text-sm text-slate-600">
          Ces réglages déterminent les créneaux proposés aux clients.
        </p>

        <form
          action={(formData) =>
            run(
              () =>
                saveBookingSettingsAction({
                  salonId: salon.id,
                  bookingLeadTimeMin: Number(formData.get('bookingLeadTimeMin')),
                  bookingHorizonDays: Number(formData.get('bookingHorizonDays')),
                  slotStepMin: Number(formData.get('slotStepMin')),
                  cancellationDeadlineHours: Number(
                    formData.get('cancellationDeadlineHours'),
                  ),
                  smsMonthlyQuota: Number(formData.get('smsMonthlyQuota')),
                }),
              'Règles enregistrées.',
            )
          }
          className="mt-5"
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="bookingLeadTimeMin" className="text-sm font-medium">
                Délai minimum avant un rendez-vous (minutes)
              </label>
              <input
                id="bookingLeadTimeMin"
                name="bookingLeadTimeMin"
                type="number"
                min={0}
                step={15}
                required
                defaultValue={salon.bookingLeadTimeMin}
                aria-describedby="aide-delai"
                className="rounded-md border border-slate-300 px-3 py-2"
              />
              <p id="aide-delai" className="text-xs text-slate-500">
                Empêche une réservation pour dans cinq minutes.
              </p>
            </div>

            <div className="flex flex-col gap-1.5">
              <label htmlFor="bookingHorizonDays" className="text-sm font-medium">
                Horizon de réservation (jours)
              </label>
              <input
                id="bookingHorizonDays"
                name="bookingHorizonDays"
                type="number"
                min={1}
                max={365}
                required
                defaultValue={salon.bookingHorizonDays}
                className="rounded-md border border-slate-300 px-3 py-2"
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <label htmlFor="slotStepMin" className="text-sm font-medium">
                Granularité des créneaux
              </label>
              <select
                id="slotStepMin"
                name="slotStepMin"
                defaultValue={salon.slotStepMin}
                className="rounded-md border border-slate-300 px-3 py-2"
              >
                {ALLOWED_SLOT_STEPS.map((step) => (
                  <option key={step} value={step}>
                    {step} minutes
                  </option>
                ))}
              </select>
            </div>

            <div className="flex flex-col gap-1.5">
              <label htmlFor="smsMonthlyQuota" className="text-sm font-medium">
                Plafond de SMS par mois
              </label>
              <input
                id="smsMonthlyQuota"
                name="smsMonthlyQuota"
                type="number"
                min={0}
                max={100000}
                required
                defaultValue={salon.smsMonthlyQuota}
                aria-describedby="aide-sms"
                className="rounded-md border border-slate-300 px-3 py-2"
              />
              <p id="aide-sms" className="text-xs text-slate-500">
                Chaque SMS est facturé. Au-delà du plafond, seuls les courriels partent.
                Zéro désactive les SMS.
              </p>
            </div>

            <div className="flex flex-col gap-1.5">
              <label htmlFor="cancellationDeadlineHours" className="text-sm font-medium">
                Délai d’annulation client (heures)
              </label>
              <input
                id="cancellationDeadlineHours"
                name="cancellationDeadlineHours"
                type="number"
                min={0}
                max={168}
                required
                defaultValue={salon.cancellationDeadlineHours}
                aria-describedby="aide-annulation"
                className="rounded-md border border-slate-300 px-3 py-2"
              />
              <p id="aide-annulation" className="text-xs text-slate-500">
                Au-delà, seul le salon peut annuler.
              </p>
            </div>
          </div>

          <button
            type="submit"
            disabled={pending}
            className="bg-brand-600 hover:bg-brand-700 mt-5 rounded-md px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            Enregistrer les règles
          </button>
        </form>
      </section>
    </div>
  )
}
