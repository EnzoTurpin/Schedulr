import type { Metadata } from 'next'
import Link from 'next/link'
import { LoginForm } from '@/features/auth/LoginForm'
import { MagicLinkForm } from '@/features/auth/MagicLinkForm'

export const metadata: Metadata = { title: 'Connexion' }

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ suite?: string; lien?: string }>
}) {
  const { suite, lien } = await searchParams

  return (
    <main
      id="contenu"
      className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-6 py-16"
    >
      <h1 className="text-2xl font-semibold tracking-tight">Connexion</h1>
      <p className="mt-2 text-sm text-slate-600">
        Accédez à vos rendez-vous ou à l’agenda de votre salon.
      </p>

      {lien === 'expire' && (
        <p
          role="alert"
          className="mt-6 rounded-md bg-amber-50 px-4 py-3 text-sm text-amber-900"
        >
          Ce lien de connexion n’est plus valable : il a déjà servi, ou plus de quinze
          minutes se sont écoulées. Demandez-en un nouveau.
        </p>
      )}

      <LoginForm suite={suite} />

      <MagicLinkForm />

      <p className="mt-8 text-sm text-slate-600">
        Pas encore de compte ?{' '}
        <Link href="/inscription" className="text-brand-700 font-medium underline">
          Créer un compte
        </Link>
      </p>
    </main>
  )
}
