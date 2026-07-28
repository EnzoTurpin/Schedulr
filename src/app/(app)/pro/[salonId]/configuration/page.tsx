import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { ServicesPanel } from '@/features/salon-admin/ServicesPanel'
import { listCatalog } from '@/features/salon-admin/services'
import { requireActor } from '@/lib/auth/actor'
import { can } from '@/lib/authz/can'

export const metadata: Metadata = { title: 'Prestations' }

export default async function ServicesPage({
  params,
}: {
  params: Promise<{ salonId: string }>
}) {
  const { salonId } = await params
  const actor = await requireActor()

  if (!can(actor, 'service:manage', { kind: 'salon', salonId })) {
    notFound()
  }

  const { categories, services } = await listCatalog(actor, salonId)

  return <ServicesPanel salonId={salonId} categories={categories} services={services} />
}
