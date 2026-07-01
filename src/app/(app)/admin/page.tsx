import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { requireActor } from '@/lib/auth/actor'
import { can } from '@/lib/authz/can'
import { crossSalon } from '@/lib/db/scoped'

export const metadata: Metadata = { title: 'Administration' }

export default async function AdminAreaPage() {
  const actor = await requireActor()

  // Contrôle serveur, indépendant du middleware.
  if (!can(actor, 'salon:create', { kind: 'platform' })) {
    notFound()
  }

  const db = crossSalon('back-office plateforme')
  const [salonCount, userCount] = await Promise.all([
    db.salon.count(),
    db.user.count({ where: { deletedAt: null } }),
  ])

  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">Administration</h1>
      <p className="mt-2 text-slate-600">Back-office complet en phase 7.</p>
      <dl className="mt-8 grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
        <dt className="text-slate-500">Salons</dt>
        <dd>{salonCount}</dd>
        <dt className="text-slate-500">Comptes actifs</dt>
        <dd>{userCount}</dd>
      </dl>
    </>
  )
}
