import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { TeamPanel } from '@/features/salon-admin/TeamPanel'
import { listCatalog } from '@/features/salon-admin/services'
import { listPendingInvitations } from '@/features/salon-admin/invitations'
import { getOpeningHours } from '@/features/salon-admin/schedule'
import { listTeam, listTimeOff } from '@/features/salon-admin/team'
import { requireActor } from '@/lib/auth/actor'
import { can } from '@/lib/authz/can'
import { crossSalon } from '@/lib/db/scoped'

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

  const [salon, members, { services }, invitations, timeOff, openingHours] =
    await Promise.all([
      crossSalon('configuration de l’équipe').salon.findUnique({
        where: { id: salonId },
        select: { timezone: true },
      }),
      listTeam(actor, salonId),
      listCatalog(actor, salonId),
      listPendingInvitations(actor, salonId),
      listTimeOff(actor, salonId),
      // Proposition par défaut : un membre sans horaires propres n'apparaît
      // sur aucun créneau de réservation.
      getOpeningHours(actor, salonId),
    ])
  if (!salon) notFound()

  return (
    <TeamPanel
      salonId={salonId}
      timezone={salon.timezone}
      members={members}
      services={services.map((service) => ({
        id: service.id,
        name: service.name,
        durationMin: service.durationMin,
        priceCents: service.priceCents,
      }))}
      invitations={invitations}
      timeOff={timeOff}
      openingHours={openingHours}
    />
  )
}
