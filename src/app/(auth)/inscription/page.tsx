import type { Metadata } from 'next'
import Link from 'next/link'
import { RegisterForm } from '@/features/auth/RegisterForm'

export const metadata: Metadata = { title: 'Créer un compte' }

export default function RegisterPage() {
  return (
    <main
      id="contenu"
      className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-6 py-16"
    >
      <h1 className="text-2xl font-semibold tracking-tight">Créer un compte</h1>
      <p className="mt-2 text-sm text-slate-600">
        Pour réserver en ligne et retrouver vos rendez-vous.
      </p>

      <RegisterForm />

      <p className="mt-8 text-sm text-slate-600">
        Déjà inscrit ?{' '}
        <Link href="/connexion" className="text-brand-700 font-medium underline">
          Se connecter
        </Link>
      </p>
    </main>
  )
}
