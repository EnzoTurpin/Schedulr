import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { SettingsPanel } from '@/features/salon-admin/SettingsPanel'
import { getSalonSettings } from '@/features/salon-admin/settings'
import { requireActor } from '@/lib/auth/actor'
import { can } from '@/lib/authz/can'

export const metadata: Metadata = { title: 'Fiche et règles' }

export default async function SettingsPage({
  params,
}: {
  params: Promise<{ salonId: string }>
}) {
  const { salonId } = await params
  const actor = await requireActor()

  if (!can(actor, 'salon:update', { kind: 'salon', salonId })) {
    notFound()
  }

  const salon = await getSalonSettings(actor, salonId)
  if (!salon) notFound()

  return <SettingsPanel salon={salon} />
}
