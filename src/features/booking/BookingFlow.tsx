'use client'

import { useEffect, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { confirmBooking, fetchSlots, type SlotView } from './actions'
import {
  formatDayLong,
  formatDuration,
  formatPrice,
  formatTime,
  groupByDay,
} from '@/lib/format'
import { cn } from '@/lib/utils'

/**
 * Tunnel de réservation : prestations → coiffeur → créneau → confirmation.
 *
 * L'état vit ici, en mémoire du navigateur ; rien n'est écrit avant la
 * confirmation finale. Toutes les valeurs envoyées au serveur y sont
 * revalidées : ce composant n'est qu'une aide à la saisie.
 */

type Service = {
  id: string
  name: string
  durationMin: number
  priceCents: number
  categoryName: string
}

type Member = { id: string; displayName: string; serviceIds: string[] }

type Props = {
  salonId: string
  salonSlug: string
  timezone: string
  services: Service[]
  members: Member[]
}

type Step = 'services' | 'staff' | 'slot' | 'confirm'

const STEPS: { id: Step; label: string }[] = [
  { id: 'services', label: 'Prestations' },
  { id: 'staff', label: 'Coiffeur' },
  { id: 'slot', label: 'Créneau' },
  { id: 'confirm', label: 'Confirmation' },
]

/** Date du jour au format `AAAA-MM-JJ`, dans le fuseau du salon. */
function todayIn(timezone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(new Date())
}

export function BookingFlow({ salonId, salonSlug, timezone, services, members }: Props) {
  const router = useRouter()
  const [step, setStep] = useState<Step>('services')
  const [selected, setSelected] = useState<string[]>([])
  const [memberId, setMemberId] = useState<string | null>(null)
  const [fromDate, setFromDate] = useState(() => todayIn(timezone))
  const [slots, setSlots] = useState<SlotView[]>([])
  const [chosen, setChosen] = useState<SlotView | null>(null)
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loadingSlots, setLoadingSlots] = useState(false)
  const [pending, startTransition] = useTransition()

  const chosenServices = services.filter((s) => selected.includes(s.id))
  const totalPrice = chosenServices.reduce((sum, s) => sum + s.priceCents, 0)
  const totalDuration = chosenServices.reduce((sum, s) => sum + s.durationMin, 0)

  // Seuls les coiffeurs réalisant toutes les prestations choisies sont
  // proposés — mêmes règles que le moteur côté serveur.
  const eligibleMembers = members.filter((m) =>
    selected.every((id) => m.serviceIds.includes(id)),
  )

  useEffect(() => {
    if (step !== 'slot') return

    let cancelled = false
    setLoadingSlots(true)
    // Volontairement, l'erreur n'est PAS effacée ici : quand une réservation
    // échoue sur un conflit, on revient à cette étape et le message doit rester
    // lisible. Sans quoi l'utilisateur voit la liste se recharger sans
    // comprendre pourquoi sa réservation n'a pas abouti.

    fetchSlots({ salonId, serviceIds: selected, memberId, fromDate })
      .then((result) => {
        if (cancelled) return
        if (result.ok) setSlots(result.slots)
        else setError(result.error)
      })
      .finally(() => {
        if (!cancelled) setLoadingSlots(false)
      })

    // Évite qu'une réponse lente d'une requête abandonnée n'écrase la suivante.
    return () => {
      cancelled = true
    }
  }, [step, salonId, selected, memberId, fromDate])

  function toggleService(id: string) {
    setSelected((current) =>
      current.includes(id) ? current.filter((s) => s !== id) : [...current, id],
    )
    setChosen(null)
  }

  function submit() {
    if (!chosen) return
    setError(null)

    startTransition(async () => {
      const result = await confirmBooking({
        salonId,
        serviceIds: selected,
        memberId,
        startAt: chosen.startAt,
        clientNote: note || undefined,
      })

      if (result.ok) {
        router.push(`/mon-compte?reservation=${result.appointmentId}`)
        return
      }

      setError(result.error)
      // Le créneau a été pris entre-temps : on revient au choix, la liste sera
      // rechargée.
      if (result.retry) {
        setChosen(null)
        setStep('slot')
      }
    })
  }

  const currentIndex = STEPS.findIndex((s) => s.id === step)

  return (
    <div>
      <ol className="flex flex-wrap gap-2 text-sm" aria-label="Étapes">
        {STEPS.map((s, index) => (
          <li key={s.id} className="flex items-center gap-2">
            <span
              aria-current={s.id === step ? 'step' : undefined}
              className={cn(
                'rounded-full px-3 py-1',
                index < currentIndex && 'bg-emerald-50 text-emerald-700',
                s.id === step && 'bg-brand-600 font-medium text-white',
                index > currentIndex && 'bg-slate-100 text-slate-500',
              )}
            >
              {index + 1}. {s.label}
            </span>
          </li>
        ))}
      </ol>

      {error && (
        <p
          role="alert"
          className="mt-6 rounded-md bg-red-50 px-4 py-3 text-sm text-red-800"
        >
          {error}
        </p>
      )}

      {step === 'services' && (
        <section aria-labelledby="etape-prestations" className="mt-8">
          <h2 id="etape-prestations" className="text-lg font-semibold">
            Choisissez vos prestations
          </h2>
          <ul className="mt-4 divide-y divide-slate-200">
            {services.map((service) => (
              <li key={service.id}>
                <label className="flex cursor-pointer items-center gap-3 py-3">
                  <input
                    type="checkbox"
                    checked={selected.includes(service.id)}
                    onChange={() => toggleService(service.id)}
                    className="size-4"
                  />
                  <span className="flex-1">
                    <span className="font-medium">{service.name}</span>
                    <span className="block text-sm text-slate-500">
                      {service.categoryName} · {formatDuration(service.durationMin)}
                    </span>
                  </span>
                  <span className="font-medium">{formatPrice(service.priceCents)}</span>
                </label>
              </li>
            ))}
          </ul>
        </section>
      )}

      {step === 'staff' && (
        <section aria-labelledby="etape-coiffeur" className="mt-8">
          <h2 id="etape-coiffeur" className="text-lg font-semibold">
            Choisissez votre coiffeur
          </h2>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <button
              type="button"
              onClick={() => setMemberId(null)}
              aria-pressed={memberId === null}
              className={cn(
                'rounded-lg border p-4 text-left',
                memberId === null ? 'border-brand-600 bg-brand-50' : 'border-slate-200',
              )}
            >
              <span className="font-medium">Peu importe</span>
              <span className="block text-sm text-slate-500">
                Plus de créneaux disponibles
              </span>
            </button>
            {eligibleMembers.map((member) => (
              <button
                key={member.id}
                type="button"
                onClick={() => setMemberId(member.id)}
                aria-pressed={memberId === member.id}
                className={cn(
                  'rounded-lg border p-4 text-left',
                  memberId === member.id
                    ? 'border-brand-600 bg-brand-50'
                    : 'border-slate-200',
                )}
              >
                <span className="font-medium">{member.displayName}</span>
              </button>
            ))}
          </div>
          {eligibleMembers.length === 0 && (
            <p className="mt-4 text-sm text-slate-600">
              Aucun coiffeur ne réalise l’ensemble des prestations choisies.
            </p>
          )}
        </section>
      )}

      {step === 'slot' && (
        <section aria-labelledby="etape-creneau" className="mt-8">
          <h2 id="etape-creneau" className="text-lg font-semibold">
            Choisissez un créneau
          </h2>

          <div className="mt-4 flex items-center gap-3">
            <label htmlFor="from-date" className="text-sm">
              À partir du
            </label>
            <input
              id="from-date"
              type="date"
              value={fromDate}
              min={todayIn(timezone)}
              onChange={(event) => setFromDate(event.target.value)}
              className="rounded-md border border-slate-300 px-3 py-1.5"
            />
          </div>

          <div aria-live="polite" className="mt-6">
            {loadingSlots && <p className="text-slate-500">Chargement des créneaux…</p>}

            {!loadingSlots && slots.length === 0 && (
              <p className="text-slate-600">
                Aucun créneau disponible sur cette période. Essayez une autre date.
              </p>
            )}

            {!loadingSlots &&
              groupByDay(slots, timezone).map((group) => (
                <div key={group.date} className="mb-6">
                  <h3 className="text-sm font-semibold text-slate-700">
                    {formatDayLong(group.slots[0]!.startAt, timezone)}
                  </h3>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {group.slots.map((slot) => (
                      <button
                        key={slot.startAt}
                        type="button"
                        onClick={() => {
                          setChosen(slot)
                          setError(null)
                        }}
                        aria-pressed={chosen?.startAt === slot.startAt}
                        className={cn(
                          'rounded-md border px-3 py-1.5 text-sm',
                          chosen?.startAt === slot.startAt
                            ? 'border-brand-600 bg-brand-600 text-white'
                            : 'hover:border-brand-400 border-slate-300',
                        )}
                      >
                        {formatTime(slot.startAt, timezone)}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
          </div>
        </section>
      )}

      {step === 'confirm' && chosen && (
        <section aria-labelledby="etape-confirmation" className="mt-8">
          <h2 id="etape-confirmation" className="text-lg font-semibold">
            Récapitulatif
          </h2>

          <dl className="mt-4 grid grid-cols-[10rem_1fr] gap-y-3 text-sm">
            <dt className="text-slate-500">Prestations</dt>
            <dd>{chosenServices.map((s) => s.name).join(', ')}</dd>
            <dt className="text-slate-500">Durée</dt>
            <dd>{formatDuration(totalDuration)}</dd>
            <dt className="text-slate-500">Coiffeur</dt>
            <dd>
              {members.find((m) => m.id === chosen.memberId)?.displayName ?? 'Attribué'}
            </dd>
            <dt className="text-slate-500">Date et heure</dt>
            <dd>
              {formatDayLong(chosen.startAt, timezone)} à{' '}
              {formatTime(chosen.startAt, timezone)}
            </dd>
            <dt className="text-slate-500">Total</dt>
            <dd className="font-medium">{formatPrice(totalPrice)}</dd>
          </dl>

          <p className="mt-4 text-sm text-slate-500">Le règlement s’effectue au salon.</p>

          <div className="mt-6">
            <label htmlFor="note" className="block text-sm font-medium">
              Message pour le salon (facultatif)
            </label>
            <textarea
              id="note"
              value={note}
              onChange={(event) => setNote(event.target.value)}
              maxLength={500}
              rows={3}
              className="mt-1.5 w-full rounded-md border border-slate-300 px-3 py-2"
            />
          </div>
        </section>
      )}

      <div className="mt-8 flex justify-between gap-4">
        <button
          type="button"
          onClick={() => setStep(STEPS[currentIndex - 1]!.id)}
          disabled={currentIndex === 0 || pending}
          className="rounded-md border border-slate-300 px-4 py-2 disabled:opacity-40"
        >
          Retour
        </button>

        {step === 'confirm' ? (
          <button
            type="button"
            onClick={submit}
            disabled={pending || !chosen}
            className="bg-brand-600 hover:bg-brand-700 rounded-md px-5 py-2 font-medium text-white disabled:opacity-60"
          >
            {pending ? 'Réservation…' : 'Confirmer le rendez-vous'}
          </button>
        ) : (
          <button
            type="button"
            onClick={() => setStep(STEPS[currentIndex + 1]!.id)}
            disabled={
              (step === 'services' && selected.length === 0) ||
              (step === 'staff' && eligibleMembers.length === 0) ||
              (step === 'slot' && !chosen)
            }
            className="bg-brand-600 hover:bg-brand-700 rounded-md px-5 py-2 font-medium text-white disabled:opacity-40"
          >
            Continuer
          </button>
        )}
      </div>

      <p className="mt-6 text-sm text-slate-500">
        <a href={`/salon/${salonSlug}`} className="underline">
          Revenir à la fiche du salon
        </a>
      </p>
    </div>
  )
}
