import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireActor } from '@/lib/auth/actor'
import { can } from '@/lib/authz/can'
import { crossSalon } from '@/lib/db/scoped'

/**
 * Enveloppe des écrans de configuration.
 *
 * Le contrôle d'accès est rejoué ici **et** dans chaque page : une enveloppe
 * partagée ne dispense pas les pages de vérifier, elles sont atteignables
 * directement.
 */
export default async function ConfigurationLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ salonId: string }>
}) {
  const { salonId } = await params
  const actor = await requireActor()

  if (!can(actor, 'service:manage', { kind: 'salon', salonId })) {
    notFound()
  }

  const salon = await crossSalon('configuration du salon').salon.findUnique({
    where: { id: salonId },
    select: { name: true },
  })
  if (!salon) notFound()

  const base = `/pro/${salonId}/configuration`
  const tabs = [
    { href: base, label: 'Prestations' },
    { href: `${base}/horaires`, label: 'Horaires' },
    { href: `${base}/equipe`, label: 'Équipe' },
    { href: `${base}/parametres`, label: 'Fiche et règles' },
  ]

  return (
    <>
      <p className="text-sm text-slate-500">
        <Link href={`/pro/${salonId}`} className="underline">
          ← Retour à l’agenda
        </Link>
      </p>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight">Configuration</h1>
      <p className="mt-1 text-sm text-slate-600">{salon.name}</p>

      <nav
        aria-label="Sections de configuration"
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
