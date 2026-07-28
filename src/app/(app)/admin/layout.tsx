import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireActor } from '@/lib/auth/actor'
import { can } from '@/lib/authz/can'

/**
 * Enveloppe du back-office plateforme.
 *
 * Le contrôle est rejoué dans chaque page : elles sont atteignables
 * directement, une enveloppe ne suffit pas.
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const actor = await requireActor()

  if (!can(actor, 'audit:read_platform', { kind: 'platform' })) {
    notFound()
  }

  const tabs = [
    { href: '/admin', label: 'Vue d’ensemble' },
    { href: '/admin/salons', label: 'Salons' },
    { href: '/admin/comptes', label: 'Comptes' },
    { href: '/admin/audit', label: 'Journal' },
  ]

  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">Administration</h1>
      <p className="mt-1 text-sm text-slate-600">Back-office plateforme</p>

      <nav
        aria-label="Sections d’administration"
        className="mt-6 border-b border-slate-200"
      >
        <ul className="flex flex-wrap gap-1">
          {tabs.map((tab) => (
            <li key={tab.href}>
              <Link
                href={tab.href}
                className="hover:border-brand-400 inline-block border-b-2 border-transparent px-4 py-2 text-sm"
              >
                {tab.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      <div className="mt-8">{children}</div>
    </>
  )
}
