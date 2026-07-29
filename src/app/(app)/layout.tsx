import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { currentActor } from '@/lib/auth/actor'
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

  return (
    <div className="min-h-dvh">
      <header className="border-b border-slate-200">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-6 py-4">
          <Link href="/" className="font-semibold">
            Schedulr
          </Link>
          <form action={logout}>
            <button type="submit" className="text-sm text-slate-600 underline">
              Se déconnecter
            </button>
          </form>
        </div>
      </header>
      <main id="contenu" className="mx-auto max-w-4xl px-6 py-10">
        {children}
      </main>
    </div>
  )
}
