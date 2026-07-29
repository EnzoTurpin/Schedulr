import Link from 'next/link'
import { currentActor } from '@/lib/auth/actor'
import { landingPath } from '@/lib/auth/actor'

export default async function PublicLayout({ children }: { children: React.ReactNode }) {
  const actor = await currentActor()

  return (
    <div className="min-h-dvh">
      <header className="border-b border-slate-200">
        <nav
          aria-label="Navigation principale"
          className="mx-auto flex max-w-4xl items-center justify-between px-6 py-4"
        >
          <Link href="/" className="text-lg font-semibold">
            Schedulr
          </Link>
          {actor ? (
            <Link href={landingPath(actor)} className="text-sm underline">
              Mon espace
            </Link>
          ) : (
            <Link href="/connexion" className="text-sm underline">
              Se connecter
            </Link>
          )}
        </nav>
      </header>
      {children}
      <footer className="mt-16 border-t border-slate-200 py-8 text-center text-sm text-slate-500">
        <p>Schedulr — réservation en ligne pour salons de coiffure</p>
        <p className="mt-2 flex flex-wrap justify-center gap-x-4 gap-y-2">
          <Link href="/confidentialite" className="underline">
            Politique de confidentialité
          </Link>
          <Link href="/mentions-legales" className="underline">
            Mentions légales
          </Link>
        </p>
      </footer>
    </div>
  )
}
