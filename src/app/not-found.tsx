import Link from 'next/link'

/**
 * Page introuvable.
 *
 * Elle sert aussi de réponse aux ressources qu'on n'a pas le droit de voir :
 * l'ADR-0002 impose un 404 plutôt qu'un 403, pour ne pas révéler l'existence
 * d'un salon à qui n'y appartient pas. Son texte doit donc rester neutre — il
 * s'adresse aussi bien à une faute de frappe qu'à une tentative d'accès.
 */
export default function NotFound() {
  return (
    <div className="mx-auto flex min-h-dvh max-w-2xl flex-col justify-center px-6 py-16">
      <p className="text-sm font-medium text-slate-500">Erreur 404</p>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight">Page introuvable</h1>
      <p className="mt-3 text-slate-600">
        Cette page n’existe pas, ou n’est plus accessible. Le lien est peut-être périmé.
      </p>
      <p className="mt-8 flex flex-wrap gap-4 text-sm">
        <Link href="/" className="text-brand-700 underline">
          Retour à l’accueil
        </Link>
        <Link href="/mon-compte" className="text-brand-700 underline">
          Mes rendez-vous
        </Link>
      </p>
    </div>
  )
}
