import Link from 'next/link'
import { formatDuration, formatPrice } from '@/lib/format'
import type { SalonStats } from './salon'

/**
 * Restitution des statistiques d'un salon.
 *
 * Composant serveur : aucune interactivité, seulement de l'affichage.
 */

function percent(value: number | null): string {
  return value === null ? '—' : `${Math.round(value * 100)} %`
}

function Tile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg border border-slate-200 p-5">
      <dt className="text-sm text-slate-500">{label}</dt>
      {/* Le texte d'aide vit dans le <dd> : un <div> enfant de <dl> n'admet
          que <dt> et <dd>, un <p> y rendrait la liste invalide. */}
      <dd className="mt-1">
        <span className="block text-2xl font-semibold tracking-tight">{value}</span>
        {hint && <span className="mt-1 block text-xs text-slate-500">{hint}</span>}
      </dd>
    </div>
  )
}

export function StatsView({
  salonId,
  stats,
  topServices,
  staff,
  period,
}: {
  salonId: string
  stats: SalonStats
  topServices: { name: string; count: number; revenueCents: number }[]
  staff: {
    memberId: string
    displayName: string
    appointments: number
    noShows: number
    minutes: number
    revenueCents: number
  }[]
  period: { from: string; to: string }
}) {
  return (
    <div>
      <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Tile label="Rendez-vous" value={String(stats.appointments)} />
        <Tile
          label="Chiffre d’affaires"
          value={formatPrice(stats.revenueCents)}
          hint="Prestations réalisées"
        />
        <Tile
          label="À venir"
          value={formatPrice(stats.expectedRevenueCents)}
          hint="Rendez-vous non encore honorés"
        />
        <Tile
          label="Taux de présence"
          value={percent(stats.attendanceRate)}
          hint={`${stats.noShows} absence${stats.noShows > 1 ? 's' : ''}`}
        />
        <Tile
          label="Taux de remplissage"
          value={percent(stats.occupancyRate)}
          hint="Congés et fermetures non déduits"
        />
        <Tile label="Annulations" value={String(stats.cancellations)} />
        <Tile label="Clients distincts" value={String(stats.newClients)} />
      </dl>

      <section aria-labelledby="top-prestations" className="mt-12">
        <h2 id="top-prestations" className="text-lg font-semibold">
          Prestations les plus demandées
        </h2>
        {topServices.length === 0 ? (
          <p className="mt-3 text-slate-600">Aucune prestation sur la période.</p>
        ) : (
          <table className="mt-4 w-full text-sm">
            <caption className="sr-only">Prestations classées par volume</caption>
            <thead>
              <tr className="border-b border-slate-200 text-left text-slate-500">
                <th scope="col" className="py-2">
                  Prestation
                </th>
                <th scope="col">Volume</th>
                <th scope="col">Chiffre d’affaires</th>
              </tr>
            </thead>
            <tbody>
              {topServices.map((service) => (
                <tr key={service.name} className="border-b border-slate-100">
                  <td className="py-2">{service.name}</td>
                  <td>{service.count}</td>
                  <td>{formatPrice(service.revenueCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section aria-labelledby="activite-equipe" className="mt-12">
        <h2 id="activite-equipe" className="text-lg font-semibold">
          Activité par coiffeur
        </h2>
        <table className="mt-4 w-full text-sm">
          <caption className="sr-only">Activité de chaque membre de l’équipe</caption>
          <thead>
            <tr className="border-b border-slate-200 text-left text-slate-500">
              <th scope="col" className="py-2">
                Coiffeur
              </th>
              <th scope="col">Rendez-vous</th>
              <th scope="col">Temps occupé</th>
              <th scope="col">Absences</th>
              <th scope="col">Chiffre d’affaires</th>
            </tr>
          </thead>
          <tbody>
            {staff.map((member) => (
              <tr key={member.memberId} className="border-b border-slate-100">
                <td className="py-2">{member.displayName}</td>
                <td>{member.appointments}</td>
                <td>{formatDuration(Math.round(member.minutes))}</td>
                <td>{member.noShows}</td>
                <td>{formatPrice(member.revenueCents)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <p className="mt-8">
        <Link
          href={`/api/salons/${salonId}/export?from=${period.from}&to=${period.to}`}
          className="rounded-md border border-slate-300 px-4 py-2 text-sm"
          prefetch={false}
        >
          Exporter les rendez-vous (CSV)
        </Link>
      </p>
    </div>
  )
}
