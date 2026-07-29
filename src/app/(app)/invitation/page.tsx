import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { AcceptInvitation } from '@/features/salon-admin/AcceptInvitation'
import { describeInvitation } from '@/features/salon-admin/invitations'
import { requireActor } from '@/lib/auth/actor'
import { prisma } from '@/lib/db/client'
import { SALON_ROLE_LABELS } from '@/lib/labels'

export const metadata: Metadata = {
  title: 'Invitation',
  robots: { index: false, follow: false },
}

/**
 * Acceptation d'une invitation à rejoindre une équipe.
 *
 * L'invitation vise une adresse précise : elle n'est acceptable que par le
 * compte correspondant, un lien transféré ne donne aucun accès.
 */
export default async function InvitationPage({
  searchParams,
}: {
  searchParams: Promise<{ jeton?: string }>
}) {
  const { jeton } = await searchParams

  if (!jeton) {
    redirect('/mon-compte')
  }

  const invitation = await describeInvitation(jeton)
  // Le layout de l'espace connecté a déjà exigé une session valide : arriver
  // ici sans acteur est impossible.
  const actor = await requireActor()

  if (!invitation) {
    return (
      <>
        <h1 className="text-2xl font-semibold tracking-tight">Invitation expirée</h1>
        <p className="mt-3 text-slate-600">
          Cette invitation n’est plus valable : elle a déjà été acceptée, elle a été
          annulée, ou plus de sept jours se sont écoulés. Demandez au salon de vous en
          envoyer une nouvelle.
        </p>
      </>
    )
  }

  const account = await prisma.user.findUniqueOrThrow({
    where: { id: actor.userId },
    select: { email: true },
  })

  const matches = account.email.toLowerCase() === invitation.email

  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">
        Rejoindre {invitation.salon.name}
      </h1>
      <p className="mt-3 text-slate-600">
        Le salon {invitation.salon.name} ({invitation.salon.city}) vous invite à rattacher
        votre compte à la fiche «&nbsp;{invitation.member.displayName}
        &nbsp;», en tant que {SALON_ROLE_LABELS[invitation.member.role].toLowerCase()}.
      </p>

      {matches ? (
        <div className="mt-8">
          <AcceptInvitation token={jeton} />
        </div>
      ) : (
        <div className="mt-8 rounded-md bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <p>
            Cette invitation a été envoyée à <strong>{invitation.email}</strong>. Vous
            êtes connecté avec {account.email}.
          </p>
          <p className="mt-3">
            <Link href="/connexion" className="underline">
              Changer de compte
            </Link>
          </p>
        </div>
      )}
    </>
  )
}
