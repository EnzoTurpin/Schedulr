import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { SchedulePanel } from '@/features/salon-admin/SchedulePanel'
import { getOpeningHours, listClosures } from '@/features/salon-admin/schedule'
import { requireActor } from '@/lib/auth/actor'
import { can } from '@/lib/authz/can'
import { crossSalon } from '@/lib/db/scoped'

export const metadata: Metadata = { title: 'Horaires' }

export default async function SchedulePage({
  params,
}: {
  params: Promise<{ salonId: string }>
}) {
  const { salonId } = await params
  const actor = await requireActor()

  if (!can(actor, 'schedule:manage_salon', { kind: 'salon', salonId })) {
    notFound()
  }

  const [salon, openingHours, closures] = await Promise.all([
    crossSalon('configuration des horaires').salon.findUnique({
      where: { id: salonId },
      select: { timezone: true },
    }),
    getOpeningHours(actor, salonId),
    listClosures(actor, salonId),
  ])
  if (!salon) notFound()

  return (
    <SchedulePanel
      salonId={salonId}
      timezone={salon.timezone}
      openingHours={openingHours}
      closures={closures}
    />
  )
}
