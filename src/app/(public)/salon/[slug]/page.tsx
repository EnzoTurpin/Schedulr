import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getPublicSalon, type PublicSalon } from '@/features/salon/queries'
import { dayName, formatDuration, formatMinutesOfDay, formatPrice } from '@/lib/format'

type Props = { params: Promise<{ slug: string }> }

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params
  const salon = await getPublicSalon(slug)

  if (!salon) {
    return { title: 'Salon introuvable' }
  }

  return {
    title: `${salon.name} — ${salon.city}`,
    description:
      salon.description ??
      `Réservez en ligne chez ${salon.name}, salon de coiffure à ${salon.city}.`,
    alternates: { canonical: `/salon/${salon.slug}` },
    openGraph: {
      title: `${salon.name} — ${salon.city}`,
      type: 'website',
    },
  }
}

/**
 * Données structurées schema.org.
 *
 * C'est ce qui permet aux moteurs d'afficher horaires et adresse directement
 * dans les résultats — l'essentiel de l'acquisition passe par là (ADR-0001).
 */
function structuredData(salon: PublicSalon) {
  return {
    '@context': 'https://schema.org',
    '@type': 'HairSalon',
    name: salon.name,
    description: salon.description ?? undefined,
    address: {
      '@type': 'PostalAddress',
      streetAddress: salon.address,
      postalCode: salon.postalCode,
      addressLocality: salon.city,
      addressCountry: salon.country,
    },
    telephone: salon.phone ?? undefined,
    geo:
      salon.latitude && salon.longitude
        ? {
            '@type': 'GeoCoordinates',
            latitude: salon.latitude,
            longitude: salon.longitude,
          }
        : undefined,
    openingHoursSpecification: salon.openingHours.map((slot) => ({
      '@type': 'OpeningHoursSpecification',
      dayOfWeek: `https://schema.org/${
        ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][
          slot.dayOfWeek
        ]
      }`,
      opens: formatMinutesOfDay(slot.startMin),
      closes: formatMinutesOfDay(slot.endMin),
    })),
    makesOffer: salon.serviceCategories.flatMap((category) =>
      category.services.map((service) => ({
        '@type': 'Offer',
        name: service.name,
        price: (service.priceCents / 100).toFixed(2),
        priceCurrency: 'EUR',
      })),
    ),
  }
}

export default async function SalonPage({ params }: Props) {
  const { slug } = await params
  const salon = await getPublicSalon(slug)

  // Un salon désactivé est indistinguable d'un salon inexistant.
  if (!salon) {
    notFound()
  }

  return (
    <main id="contenu" className="mx-auto max-w-4xl px-6 py-12">
      <script
        type="application/ld+json"
        // Contenu issu de notre base et sérialisé par JSON.stringify, jamais
        // d'une saisie libre non échappée.
        dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData(salon)) }}
      />

      <h1 className="text-3xl font-semibold tracking-tight">{salon.name}</h1>
      <p className="mt-2 text-slate-600">
        {salon.address}, {salon.postalCode} {salon.city}
      </p>
      {salon.description && <p className="mt-4 text-slate-700">{salon.description}</p>}

      <Link
        href={`/reserver/${salon.slug}`}
        className="bg-brand-600 hover:bg-brand-700 mt-6 inline-block rounded-md px-5 py-2.5 font-medium text-white"
      >
        Prendre rendez-vous
      </Link>

      <section aria-labelledby="prestations" className="mt-12">
        <h2 id="prestations" className="text-xl font-semibold">
          Prestations
        </h2>
        {salon.serviceCategories.map((category) => (
          <div key={category.id} className="mt-6">
            <h3 className="text-sm font-semibold tracking-wide text-slate-500 uppercase">
              {category.name}
            </h3>
            <ul className="mt-2 divide-y divide-slate-200">
              {category.services.map((service) => (
                <li key={service.id} className="flex justify-between gap-4 py-3">
                  <div>
                    <p className="font-medium">{service.name}</p>
                    {service.description && (
                      <p className="text-sm text-slate-500">{service.description}</p>
                    )}
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="font-medium">{formatPrice(service.priceCents)}</p>
                    <p className="text-sm text-slate-500">
                      {formatDuration(service.durationMin)}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </section>

      <section aria-labelledby="equipe" className="mt-12">
        <h2 id="equipe" className="text-xl font-semibold">
          L’équipe
        </h2>
        <ul className="mt-4 grid gap-4 sm:grid-cols-2">
          {salon.members.map((member) => (
            <li key={member.id} className="rounded-lg border border-slate-200 p-4">
              <p className="font-medium">{member.displayName}</p>
              {member.bio && <p className="mt-1 text-sm text-slate-500">{member.bio}</p>}
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="horaires" className="mt-12">
        <h2 id="horaires" className="text-xl font-semibold">
          Horaires d’ouverture
        </h2>
        <dl className="mt-4 grid max-w-md grid-cols-[8rem_1fr] gap-y-2 text-sm">
          {[1, 2, 3, 4, 5, 6, 0].map((day) => {
            const ranges = salon.openingHours.filter((slot) => slot.dayOfWeek === day)
            return (
              <div key={day} className="contents">
                <dt className="text-slate-500">{dayName(day)}</dt>
                <dd>
                  {ranges.length === 0
                    ? 'Fermé'
                    : ranges
                        .map(
                          (r) =>
                            `${formatMinutesOfDay(r.startMin)} – ${formatMinutesOfDay(r.endMin)}`,
                        )
                        .join(' · ')}
                </dd>
              </div>
            )
          })}
        </dl>
      </section>
    </main>
  )
}
