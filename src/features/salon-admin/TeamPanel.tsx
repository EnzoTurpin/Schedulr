'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { SALON_ROLE_LABELS } from '@/lib/labels'
import {
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
 * immédiatement, le rattachement à un compte viendra par invitation lorsque
 * l'envoi de courriels sera livré.
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
}

type Invitation = {
  id: string
  memberId: string
  email: string
  expiresAt: Date
}

type Props = {
  salonId: string
  members: Member[]
  services: { id: string; name: string }[]
  invitations: Invitation[]
}

const DEFAULT_COLOR = '#8b5cf6'

export function TeamPanel({ salonId, members, services, invitations }: Props) {
  const router = useRouter()
  const [editing, setEditing] = useState<Member | 'new' | null>(null)
  const [assigning, setAssigning] = useState<Member | null>(null)
  const [inviting, setInviting] = useState<Member | null>(null)
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
        <form
          action={(formData) =>
            run(
              () =>
                saveMemberAction({
                  salonId,
                  memberId: editing !== 'new' && editing ? editing.id : undefined,
                  displayName: String(formData.get('displayName') ?? ''),
                  bio: String(formData.get('bio') ?? '') || undefined,
                  color: String(formData.get('color') ?? DEFAULT_COLOR),
                  role: String(formData.get('role') ?? 'STAFF') as Member['role'],
                  isBookable: formData.get('isBookable') === 'on',
                }),
              () => setEditing(null),
            )
          }
          className="mt-6 rounded-lg border border-slate-200 p-5"
        >
          <h3 className="font-medium">
            {editing === 'new' ? 'Nouveau membre' : `Modifier « ${draft.displayName} »`}
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
                defaultValue={draft.displayName}
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
                defaultValue={draft.role}
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
                defaultValue={draft.color}
                className="h-10 w-20 rounded-md border border-slate-300"
              />
            </div>

            <div className="flex items-center gap-2 pt-6">
              <input
                id="isBookable"
                name="isBookable"
                type="checkbox"
                defaultChecked={draft.isBookable}
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
              defaultValue={draft.bio ?? ''}
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
                    onClick={() =>
                      run(() => deactivateMemberAction({ salonId, memberId: member.id }))
                    }
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
          </li>
        ))}
      </ul>
    </section>
  )
}
