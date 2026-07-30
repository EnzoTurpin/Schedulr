'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import {
  cancelAppointmentsAction,
  deactivateMemberAction,
  transferAppointmentsAction,
} from './actions'

/**
 * Désactivation d'un membre ayant des rendez-vous à venir.
 *
 * La désactivation est refusée tant qu'il en reste : ils disparaissaient de
 * l'agenda tout en restant confirmés côté client, qui se présentait pour rien.
 * Le salon choisit donc explicitement leur sort, et chaque client est prévenu.
 */

type Props = {
  salonId: string
  member: { id: string; displayName: string }
  upcoming: number
  /** Coiffeurs actifs pouvant reprendre les rendez-vous. */
  candidates: { id: string; label: string }[]
  onClose: () => void
  onDone: () => void
}

export function DeactivateMemberDialog({
  salonId,
  member,
  upcoming,
  candidates,
  onClose,
  onDone,
}: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const [target, setTarget] = useState(candidates[0]?.id ?? '')
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  useEffect(() => {
    dialogRef.current?.showModal()
  }, [])

  /** Enchaîne le traitement des rendez-vous puis la désactivation. */
  function run(handle: () => Promise<{ ok: boolean; error?: string }>) {
    setError(null)
    setNotice(null)
    startTransition(async () => {
      const handled = await handle()
      if (!handled.ok) {
        setError(handled.error ?? 'L’opération a échoué.')
        return
      }

      const deactivated = await deactivateMemberAction({ salonId, memberId: member.id })
      if (!deactivated.ok) {
        // Le traitement a réussi mais des rendez-vous subsistent : le message
        // de l'erreur en donne le compte exact.
        setError(deactivated.error)
        return
      }
      onDone()
    })
  }

  return (
    <dialog
      ref={dialogRef}
      onClose={onClose}
      aria-labelledby="titre-desactivation"
      className="w-[min(32rem,calc(100vw-2rem))] rounded-lg p-0 backdrop:bg-slate-900/40"
    >
      <div className="p-6">
        <h2 id="titre-desactivation" className="text-lg font-semibold">
          Désactiver {member.displayName}
        </h2>

        <p className="mt-3 text-sm text-slate-700">
          {upcoming === 1
            ? 'Un rendez-vous à venir lui est encore attribué.'
            : `${upcoming} rendez-vous à venir lui sont encore attribués.`}{' '}
          Choisissez leur sort : sans cela ils disparaîtraient de l’agenda alors que les
          clients les auraient toujours.
        </p>

        {error && (
          <p
            role="alert"
            className="mt-4 rounded-md bg-red-50 px-4 py-3 text-sm text-red-800"
          >
            {error}
          </p>
        )}
        {notice && (
          <p
            role="status"
            className="mt-4 rounded-md bg-amber-50 px-4 py-3 text-sm text-amber-900"
          >
            {notice}
          </p>
        )}

        {candidates.length > 0 ? (
          <div className="mt-6 rounded-md border border-slate-200 p-4">
            <h3 className="text-sm font-medium">Transférer à un autre coiffeur</h3>
            <p className="mt-1 text-xs text-slate-500">
              Chaque client est prévenu du changement. Un rendez-vous dont le créneau est
              déjà occupé chez la personne choisie reste à traiter à la main.
            </p>

            <div className="mt-3 flex flex-wrap items-end gap-3">
              <div className="flex flex-col gap-1.5">
                <label htmlFor="transfert-cible" className="text-sm">
                  Coiffeur
                </label>
                <select
                  id="transfert-cible"
                  value={target}
                  onChange={(domEvent) => setTarget(domEvent.target.value)}
                  className="rounded-md border border-slate-300 px-3 py-2 text-sm"
                >
                  {candidates.map((candidate) => (
                    <option key={candidate.id} value={candidate.id}>
                      {candidate.label}
                    </option>
                  ))}
                </select>
              </div>

              <button
                type="button"
                disabled={pending || !target}
                onClick={() =>
                  run(async () => {
                    const result = await transferAppointmentsAction({
                      salonId,
                      fromMemberId: member.id,
                      toMemberId: target,
                    })
                    if (result.ok && result.failed > 0) {
                      setNotice(
                        `${result.moved} rendez-vous transférés. ${result.failed} n’ont pas pu l’être : ` +
                          `le créneau est déjà occupé. Déplacez-les depuis l’agenda.`,
                      )
                    }
                    return result
                  })
                }
                className="bg-brand-600 hover:bg-brand-700 rounded-md px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
              >
                Transférer puis désactiver
              </button>
            </div>
          </div>
        ) : (
          <p className="mt-6 rounded-md bg-slate-50 px-4 py-3 text-sm text-slate-700">
            Aucun autre coiffeur actif ne peut reprendre ces rendez-vous.
          </p>
        )}

        <div className="mt-4 rounded-md border border-red-200 p-4">
          <h3 className="text-sm font-medium">Annuler tous les rendez-vous</h3>
          <p className="mt-1 text-xs text-slate-500">
            Irréversible. Chaque client reçoit un avis d’annulation.
          </p>
          <button
            type="button"
            disabled={pending}
            onClick={() =>
              run(() => cancelAppointmentsAction({ salonId, memberId: member.id }))
            }
            className="mt-3 rounded-md border border-red-400 px-4 py-2 text-sm font-medium text-red-700 disabled:opacity-50"
          >
            Annuler puis désactiver
          </button>
        </div>

        <button
          type="button"
          onClick={() => dialogRef.current?.close()}
          className="mt-6 text-sm text-slate-600 underline"
        >
          Ne rien faire
        </button>
      </div>
    </dialog>
  )
}
