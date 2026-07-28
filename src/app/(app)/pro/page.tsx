import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { requireActor, professionalSalons } from '@/lib/auth/actor'
import { crossSalon } from '@/lib/db/scoped'

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
    select: { id: true, name: true, city: true },
  })

  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">Espace professionnel</h1>
      <p className="mt-2 text-slate-600">L’agenda arrive en phase 4. Vos salons :</p>
      <ul className="mt-6 divide-y divide-slate-200">
        {salons.map((salon) => {
          const membership = memberships.find((m) => m.salonId === salon.id)
          return (
            <li key={salon.id} className="flex justify-between py-3">
              <span>
                {salon.name} <span className="text-slate-400">— {salon.city}</span>
              </span>
              <span className="text-sm text-slate-500">{membership?.role}</span>
            </li>
          )
        })}
      </ul>
    </>
  )
}
