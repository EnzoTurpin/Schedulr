'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { SALON_ROLE_LABELS } from '@/lib/labels'
import { DeactivateMemberDialog } from './DeactivateMemberDialog'
import { MemberForm } from './MemberForm'
import { MemberSchedule, type TimeOff } from './MemberSchedule'
import type { Week } from './WeekEditor'
import {
  countUpcomingAction,
  deactivateMemberAction,
  inviteMemberAction,
  revokeInvitationAction,
  saveMemberAction,
  setMemberServicesAction,
} from './actions'

/**
 * Équipe du salon : membres, rôles, prestations réalisées.
 *
 * Un membre peut être créé sans compte : sa fiche et son agenda existent
 * immédiatement, le rattachement à un compte se fait ensuite par invitation.
 */

type Member = {
  id: string
  displayName: string
  bio: string | null
  color: string
  role: 'OWNER' | 'MANAGER' | 'STAFF'
  isBookable: boolean
  isActive: boolean
  userId: string | null
  user: { email: string } | null
  services: { serviceId: string }[]
  workingHours: { dayOfWeek: number; startMin: number; endMin: number }[]
}

type Invitation = {
  id: string
  memberId: string
  email: string
  expiresAt: Date
}

type Props = {
  salonId: string
  timezone: string
  members: Member[]
  services: { id: string; name: string }[]
  invitations: Invitation[]
  timeOff: TimeOff[]
  /** Horaires du salon, proposés par défaut à un membre qui n'en a aucun. */
  openingHours: Week
}

/** Regroupe des plages par jour, forme attendue par l'éditeur de semaine. */
function toWeek(hours: Member['workingHours']): Week {
  const week: Week = {}
  for (const hour of hours) {
    week[hour.dayOfWeek] = [
      ...(week[hour.dayOfWeek] ?? []),
      { startMin: hour.startMin, endMin: hour.endMin },
    ]
  }
  return week
}

const DEFAULT_COLOR = '#8b5cf6'

export function TeamPanel({
  salonId,
  timezone,
  members,
  services,
  invitations,
  timeOff,
  openingHours,
}: Props) {
  const router = useRouter()
  const [editing, setEditing] = useState<Member | 'new' | null>(null)
  const [assigning, setAssigning] = useState<Member | null>(null)
  const [inviting, setInviting] = useState<Member | null>(null)
  const [scheduling, setScheduling] = useState<Member | null>(null)
  const [deactivating, setDeactivating] = useState<{
    member: Member
    upcoming: number
  } | null>(null)
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
        setError(result.error ?? 'L’enregistrement a échoué.')
        return
      }
      onDone?.()
      router.refresh()
    })
  }

  const draft =
    editing === 'new'
      ? {
          id: '',
          displayName: '',
          bio: null,
          color: DEFAULT_COLOR,
          role: 'STAFF' as const,
          isBookable: true,
          isActive: true,
          userId: null,
          user: null,
          services: [],
          workingHours: [],
        }
      : editing

  return (
    <section aria-labelledby="titre-equipe">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 id="titre-equipe" className="text-lg font-semibold">
          Équipe
        </h2>
        <button
          type="button"
          onClick={() => setEditing('new')}
          className="bg-brand-600 hover:bg-brand-700 rounded-md px-4 py-2 text-sm font-medium text-white"
        >
          Ajouter un membre
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

      {draft && (
        <MemberForm
          editedName={editing !== 'new' && editing ? editing.displayName : null}
          values={draft}
          pending={pending}
          onSubmit={(values) =>
            run(
              () =>
                saveMemberAction({
                  salonId,
                  memberId: editing !== 'new' && editing ? editing.id : undefined,
                  ...values,
                  bio: values.bio ?? undefined,
                }),
              () => setEditing(null),
            )
          }
          onCancel={() => setEditing(null)}
        />
      )}

      <ul className="mt-6 divide-y divide-slate-200">
        {members.map((member) => (
          <li key={member.id} className="py-4">
            <div className="flex flex-wrap items-baseline justify-between gap-3">
              <div className="flex items-center gap-3">
                <span
                  aria-hidden="true"
                  className="size-3 rounded-full"
                  style={{ backgroundColor: member.color }}
                />
                <span className="font-medium">{member.displayName}</span>
                <span className="text-sm text-slate-500">
                  {SALON_ROLE_LABELS[member.role]}
                </span>
                {!member.isActive && (
                  <span className="rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
                    Désactivé
                  </span>
                )}
                {!member.isBookable && member.isActive && (
                  <span className="rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
                    Non réservable
                  </span>
                )}
                {member.isActive &&
                  member.isBookable &&
                  member.workingHours.length === 0 && (
                    <span className="rounded bg-amber-100 px-2 py-0.5 text-xs text-amber-900">
                      Sans horaires
                    </span>
                  )}
              </div>

              {member.isActive && (
                <div className="flex gap-3 text-sm">
                  <button
                    type="button"
                    onClick={() => setEditing(member)}
                    className="underline"
                  >
                    Modifier
                  </button>
                  <button
                    type="button"
                    onClick={() => setAssigning(member)}
                    className="underline"
                  >
                    Prestations
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setScheduling((current) =>
                        current?.id === member.id ? null : member,
                      )
                    }
                    className="underline"
                  >
                    Horaires
                  </button>
                  {!member.userId && (
                    <button
                      type="button"
                      onClick={() => setInviting(member)}
                      className="underline"
                    >
                      {invitations.some((i) => i.memberId === member.id)
                        ? 'Relancer'
                        : 'Inviter'}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      setError(null)
                      startTransition(async () => {
                        // Les rendez-vous à venir décident du parcours : sans
                        // eux la désactivation est immédiate, sinon le salon
                        // doit trancher leur sort.
                        const counted = await countUpcomingAction({
                          salonId,
                          memberId: member.id,
                        })
                        if (!counted.ok) {
                          setError(counted.error)
                          return
                        }
                        if (counted.count === 0) {
                          run(() =>
                            deactivateMemberAction({ salonId, memberId: member.id }),
                          )
                          return
                        }
                        setDeactivating({ member, upcoming: counted.count })
                      })
                    }}
                    className="text-red-700 underline"
                  >
                    Désactiver
                  </button>
                </div>
              )}
            </div>

            <p className="mt-1 text-sm text-slate-500">
              {member.user?.email ?? 'Aucun compte rattaché'} · {member.services.length}{' '}
              prestation
              {member.services.length > 1 ? 's' : ''}
            </p>

            {inviting?.id === member.id && (
              <form
                action={(formData) =>
                  run(
                    () =>
                      inviteMemberAction({
                        salonId,
                        memberId: member.id,
                        email: String(formData.get('email') ?? ''),
                      }),
                    () => setInviting(null),
                  )
                }
                className="mt-4 rounded-md bg-slate-50 p-4"
              >
                <label htmlFor={`invite-${member.id}`} className="text-sm font-medium">
                  Adresse électronique de {member.displayName}
                </label>
                <p className="mt-1 text-xs text-slate-500">
                  Un lien lui sera envoyé pour rattacher son compte à cette fiche.
                  L’invitation expire dans sept jours.
                </p>
                <input
                  id={`invite-${member.id}`}
                  name="email"
                  type="email"
                  required
                  defaultValue={
                    invitations.find((i) => i.memberId === member.id)?.email ?? ''
                  }
                  className="mt-2 w-full max-w-sm rounded-md border border-slate-300 px-3 py-2"
                />

                <div className="mt-4 flex flex-wrap gap-3">
                  <button
                    type="submit"
                    disabled={pending}
                    className="bg-brand-600 hover:bg-brand-700 rounded-md px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
                  >
                    Envoyer l’invitation
                  </button>
                  {invitations.some((i) => i.memberId === member.id) && (
                    <button
                      type="button"
                      onClick={() =>
                        run(
                          () =>
                            revokeInvitationAction({
                              salonId,
                              memberId: member.id,
                            }),
                          () => setInviting(null),
                        )
                      }
                      className="rounded-md border border-red-300 px-3 py-1.5 text-sm text-red-700"
                    >
                      Annuler l’invitation
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setInviting(null)}
                    className="rounded-md border border-slate-300 px-3 py-1.5 text-sm"
                  >
                    Fermer
                  </button>
                </div>
              </form>
            )}

            {assigning?.id === member.id && (
              <form
                action={(formData) =>
                  run(
                    () =>
                      setMemberServicesAction({
                        salonId,
                        memberId: member.id,
                        serviceIds: formData.getAll('serviceIds').map(String),
                      }),
                    () => setAssigning(null),
                  )
                }
                className="mt-4 rounded-md bg-slate-50 p-4"
              >
                <fieldset>
                  <legend className="text-sm font-medium">
                    Prestations réalisées par {member.displayName}
                  </legend>
                  <div className="mt-3 grid gap-2 sm:grid-cols-2">
                    {services.map((service) => (
                      <label key={service.id} className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          name="serviceIds"
                          value={service.id}
                          defaultChecked={member.services.some(
                            (s) => s.serviceId === service.id,
                          )}
                          className="size-4"
                        />
                        {service.name}
                      </label>
                    ))}
                  </div>
                </fieldset>

                <div className="mt-4 flex gap-3">
                  <button
                    type="submit"
                    disabled={pending}
                    className="bg-brand-600 hover:bg-brand-700 rounded-md px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
                  >
                    Enregistrer
                  </button>
                  <button
                    type="button"
                    onClick={() => setAssigning(null)}
                    className="rounded-md border border-slate-300 px-3 py-1.5 text-sm"
                  >
                    Annuler
                  </button>
                </div>
              </form>
            )}

            {scheduling?.id === member.id && (
              <MemberSchedule
                salonId={salonId}
                memberId={member.id}
                memberName={member.displayName}
                timezone={timezone}
                workingHours={toWeek(member.workingHours)}
                timeOff={timeOff.filter((absence) => absence.memberId === member.id)}
                openingHours={openingHours}
                onClose={() => setScheduling(null)}
              />
            )}
          </li>
        ))}
      </ul>

      {deactivating && (
        <DeactivateMemberDialog
          salonId={salonId}
          member={deactivating.member}
          upcoming={deactivating.upcoming}
          candidates={members
            .filter(
              (candidate) =>
                candidate.isActive && candidate.id !== deactivating.member.id,
            )
            .map((candidate) => ({ id: candidate.id, label: candidate.displayName }))}
          onClose={() => setDeactivating(null)}
          onDone={() => {
            setDeactivating(null)
            router.refresh()
          }}
        />
      )}
    </section>
  )
}
