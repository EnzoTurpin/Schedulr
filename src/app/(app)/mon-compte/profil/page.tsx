import type { Metadata } from 'next'
import Link from 'next/link'
import { ProfileForm } from '@/features/account/ProfileForm'
import { getProfile } from '@/features/account/profile'
import { requireActor } from '@/lib/auth/actor'

export const metadata: Metadata = { title: 'Mon profil' }

export default async function ProfilePage() {
  const actor = await requireActor()
  const profile = await getProfile(actor)

  return (
    <>
      <p className="text-sm text-slate-500">
        <Link href="/mon-compte" className="underline">
          ← Retour à mes rendez-vous
        </Link>
      </p>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight">Mon profil</h1>
      <p className="mt-2 text-slate-600">
        Ces informations sont transmises au salon lors d’une réservation.
      </p>

      <div className="mt-8 max-w-2xl">
        <ProfileForm
          email={profile.email}
          firstName={profile.firstName}
          lastName={profile.lastName}
          phone={profile.phone}
        />
      </div>
    </>
  )
}
