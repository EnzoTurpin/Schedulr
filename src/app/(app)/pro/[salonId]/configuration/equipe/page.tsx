import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { TeamPanel } from '@/features/salon-admin/TeamPanel'
import { listCatalog } from '@/features/salon-admin/services'
import { listTeam } from '@/features/salon-admin/team'
import { requireActor } from '@/lib/auth/actor'
import { can } from '@/lib/authz/can'

export const metadata: Metadata = { title: 'Équipe' }

export default async function TeamPage({
  params,
}: {
  params: Promise<{ salonId: string }>
}) {
  const { salonId } = await params
  const actor = await requireActor()

  // La gestion de l'équipe est réservée au gérant, contrairement au reste de
  // la configuration ouverte aux managers.
  if (!can(actor, 'member:manage', { kind: 'salon', salonId })) {
    notFound()
  }

  const [members, { services }] = await Promise.all([
    listTeam(actor, salonId),
    listCatalog(actor, salonId),
  ])

  return (
    <TeamPanel
      salonId={salonId}
      members={members}
      services={services.map((s) => ({ id: s.id, name: s.name }))}
    />
  )
}
