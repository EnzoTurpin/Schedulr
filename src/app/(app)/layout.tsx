import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { currentActor, professionalSalons } from '@/lib/auth/actor'
import { logout } from '@/features/auth/actions'

/**
 * Enveloppe des espaces connectés.
 *
 * Rejoue l'authentification côté serveur : le middleware n'a fait que
 * constater la présence d'un cookie, il ne l'a pas validé.
 */
/** Aucun espace connecté ne doit apparaître dans un moteur de recherche. */
export const metadata: Metadata = { robots: { index: false, follow: false } }

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const actor = await currentActor()
  if (!actor) {
    redirect('/connexion')
  }

  // Une même personne peut être cliente ici et gérante là : sans ces liens, on
  // ne peut passer d'un espace à l'autre qu'en modifiant l'URL.
  const spaces = [
    { href: '/mon-compte', label: 'Mes rendez-vous', shown: true },
    { href: '/pro', label: 'Espace pro', shown: professionalSalons(actor).length > 0 },
    { href: '/admin', label: 'Administration', shown: actor.role === 'PLATFORM_ADMIN' },
  ].filter((space) => space.shown)

  return (
    <div className="min-h-dvh">
      <header className="border-b border-slate-200">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-x-6 gap-y-3 px-6 py-4">
          <Link href="/" className="font-semibold">
            Schedulr
          </Link>

          <nav aria-label="Espaces" className="order-last w-full sm:order-none sm:w-auto">
            <ul className="flex flex-wrap gap-4 text-sm">
              {spaces.map((space) => (
                <li key={space.href}>
                  <Link href={space.href} className="text-slate-600 hover:underline">
                    {space.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>

          <form action={logout}>
            <button type="submit" className="text-sm text-slate-600 underline">
              Se déconnecter
            </button>
          </form>
        </div>
      </header>
      {/* Plus large que les pages publiques : ce sont des écrans de gestion.
          L'agenda multi-coiffeurs et les tableaux d'administration défilaient
          horizontalement dès quatre colonnes. */}
      <main id="contenu" className="mx-auto max-w-6xl px-6 py-10">
        {children}
      </main>
    </div>
  )
}
