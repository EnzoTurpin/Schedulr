import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import { BookingFlow } from '@/features/booking/BookingFlow'
import { getPublicSalon } from '@/features/salon/queries'
import { currentActor } from '@/lib/auth/actor'

type Props = { params: Promise<{ slug: string }> }

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params
  const salon = await getPublicSalon(slug)

  return {
    title: salon ? `Réserver chez ${salon.name}` : 'Réserver',
    // Le tunnel n'a pas vocation à être indexé : c'est la fiche salon qui porte
    // le référencement.
    robots: { index: false, follow: true },
  }
}

export default async function BookingPage({ params }: Props) {
  const { slug } = await params
  const salon = await getPublicSalon(slug)

  if (!salon) {
    notFound()
  }

  // La réservation en ligne exige un compte : c'est ce qui permet au client de
  // retrouver et d'annuler son rendez-vous.
  const actor = await currentActor()
  if (!actor) {
    redirect(`/connexion?suite=${encodeURIComponent(`/reserver/${slug}`)}`)
  }

  const services = salon.serviceCategories.flatMap((category) =>
    category.services.map((service) => ({
      id: service.id,
      name: service.name,
      durationMin: service.durationMin,
      priceCents: service.priceCents,
      categoryName: category.name,
    })),
  )

  const members = salon.members.map((member) => ({
    id: member.id,
    displayName: member.displayName,
    serviceIds: member.services.map((s) => s.serviceId),
  }))

  return (
    <main id="contenu" className="mx-auto max-w-2xl px-6 py-12">
      <h1 className="text-2xl font-semibold tracking-tight">
        Réserver chez {salon.name}
      </h1>
      <p className="mt-2 text-sm text-slate-600">
        {salon.address}, {salon.postalCode} {salon.city}
      </p>

      <div className="mt-8">
        <BookingFlow
          salonId={salon.id}
          salonSlug={salon.slug}
          timezone={salon.timezone}
          services={services}
          members={members}
        />
      </div>
    </main>
  )
}
