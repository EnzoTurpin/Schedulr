import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireActor, professionalSalons } from '@/lib/auth/actor'
import { crossSalon } from '@/lib/db/scoped'
import { SALON_ROLE_LABELS } from '@/lib/labels'

export const metadata: Metadata = { title: 'Espace professionnel' }

export default async function ProAreaPage() {
  const actor = await requireActor()
  const memberships = professionalSalons(actor)

  // Un compte sans appartenance active n'a pas à savoir que cet espace existe
  // (ADR-0002 : 404 plutôt que 403).
  if (memberships.length === 0 && actor.role !== 'PLATFORM_ADMIN') {
    notFound()
  }

  const salons = await crossSalon('liste des salons du membre connecté').salon.findMany({
    where: { id: { in: memberships.map((m) => m.salonId) } },
    select: {
      id: true,
      name: true,
      city: true,
      // Un salon sans prestation ni horaire n'est pas réservable : il faut le
      // signaler, sans quoi un gérant qui vient de créer le sien ne comprend
      // pas pourquoi son agenda reste vide.
      _count: { select: { services: true, openingHours: true } },
    },
    orderBy: { name: 'asc' },
  })

  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">Espace professionnel</h1>
      <p className="mt-2 text-slate-600">
        {salons.length > 1 ? 'Choisissez un salon.' : 'Votre salon.'}
      </p>

      <ul className="mt-6 divide-y divide-slate-200">
        {salons.map((salon) => {
          const membership = memberships.find((m) => m.salonId === salon.id)
          const needsSetup =
            salon._count.services === 0 || salon._count.openingHours === 0

          return (
            <li key={salon.id}>
              <Link
                href={`/pro/${salon.id}`}
                className="-mx-3 flex items-center justify-between gap-4 rounded-md px-3 py-4 hover:bg-slate-50"
              >
                <span>
                  <span className="font-medium">{salon.name}</span>
                  <span className="text-slate-400"> — {salon.city}</span>
                  {needsSetup && (
                    <span className="mt-1 block text-sm text-amber-700">
                      À configurer : sans prestation ni horaire d’ouverture, ce salon
                      n’accepte aucune réservation.
                    </span>
                  )}
                </span>
                <span className="text-sm whitespace-nowrap text-slate-500">
                  {membership ? SALON_ROLE_LABELS[membership.role] : 'Administration'}
                </span>
              </Link>
            </li>
          )
        })}
      </ul>
    </>
  )
}
