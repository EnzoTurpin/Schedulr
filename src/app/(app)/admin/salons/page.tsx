import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { SalonsPanel } from '@/features/admin/SalonsPanel'
import { listSalons } from '@/features/admin/queries'
import { requireActor } from '@/lib/auth/actor'
import { can } from '@/lib/authz/can'

export const metadata: Metadata = { title: 'Salons' }

export default async function AdminSalonsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; q?: string }>
}) {
  const actor = await requireActor()
  if (!can(actor, 'audit:read_platform', { kind: 'platform' })) {
    notFound()
  }

  const query = await searchParams
  const page = Math.max(1, Number(query.page ?? '1') || 1)
  const result = await listSalons(actor, { page, q: query.q })

  return <SalonsPanel {...result} query={query.q ?? ''} />
}
