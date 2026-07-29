import type { Metadata } from 'next'
import Link from 'next/link'

export const metadata: Metadata = {
  title: 'Mentions légales',
  description:
    'Éditeur, hébergeur et conditions d’utilisation du service de réservation Schedulr.',
}

/**
 * Mentions légales.
 *
 * ⚠️ **Gabarit à compléter.** Les articles 6-III de la LCEN et L. 111-1 du code
 * de la consommation imposent d'identifier l'éditeur et l'hébergeur ; ces
 * informations ne peuvent être qu'apportées par l'exploitant. Les emplacements
 * à remplir sont marqués `À COMPLÉTER` et volontairement visibles : une mention
 * absente se remarque, une mention inventée non.
 *
 * Le reste du texte décrit fidèlement le fonctionnement du service tel qu'il
 * est codé, mais n'a pas été relu par un juriste.
 */

/** Emplacement à renseigner avant toute mise en ligne. */
function ToFill({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded bg-amber-100 px-1.5 py-0.5 font-medium text-amber-900">
      À COMPLÉTER — {children}
    </span>
  )
}

export default function LegalPage() {
  return (
    <main id="contenu" className="mx-auto max-w-2xl px-6 py-12">
      <h1 className="text-3xl font-semibold tracking-tight">Mentions légales</h1>

      <p className="mt-4 rounded-md bg-amber-50 px-4 py-3 text-sm text-amber-900">
        Ce document est un gabarit. Les informations d’identification de l’éditeur et de
        l’hébergeur relèvent de l’exploitant du service et doivent être renseignées avant
        toute mise en ligne : les inventer serait une fausse déclaration.
      </p>

      <section aria-labelledby="editeur" className="mt-10">
        <h2 id="editeur" className="text-xl font-semibold">
          Éditeur du site
        </h2>
        <dl className="mt-4 space-y-3 text-sm">
          <div>
            <dt className="font-medium">Dénomination sociale</dt>
            <dd className="text-slate-700">
              <ToFill>raison sociale et forme juridique</ToFill>
            </dd>
          </div>
          <div>
            <dt className="font-medium">Siège social</dt>
            <dd className="text-slate-700">
              <ToFill>adresse postale complète</ToFill>
            </dd>
          </div>
          <div>
            <dt className="font-medium">Immatriculation</dt>
            <dd className="text-slate-700">
              <ToFill>numéro SIREN et ville du registre du commerce</ToFill>
            </dd>
          </div>
          <div>
            <dt className="font-medium">Numéro de TVA intracommunautaire</dt>
            <dd className="text-slate-700">
              <ToFill>si assujetti</ToFill>
            </dd>
          </div>
          <div>
            <dt className="font-medium">Contact</dt>
            <dd className="text-slate-700">
              <ToFill>adresse électronique et numéro de téléphone</ToFill>
            </dd>
          </div>
          <div>
            <dt className="font-medium">Directeur de la publication</dt>
            <dd className="text-slate-700">
              <ToFill>nom du représentant légal</ToFill>
            </dd>
          </div>
        </dl>
      </section>

      <section aria-labelledby="hebergeur" className="mt-10">
        <h2 id="hebergeur" className="text-xl font-semibold">
          Hébergement
        </h2>
        <p className="mt-4 text-sm text-slate-700">
          Le site est hébergé par <ToFill>raison sociale de l’hébergeur</ToFill>,{' '}
          <ToFill>adresse et téléphone</ToFill>. Les données sont stockées dans une base
          PostgreSQL, dont la localisation dépend de l’hébergeur retenu.
        </p>
      </section>

      <section aria-labelledby="objet" className="mt-10">
        <h2 id="objet" className="text-xl font-semibold">
          Objet du service
        </h2>
        <p className="mt-4 text-sm text-slate-700">
          Schedulr met en relation des salons de coiffure et leurs clients pour la prise
          de rendez-vous en ligne. Le service ne réalise aucune prestation de coiffure et
          n’encaisse aucun paiement : la prestation, son prix et son exécution relèvent
          exclusivement du salon choisi.
        </p>
      </section>

      <section aria-labelledby="responsabilite" className="mt-10">
        <h2 id="responsabilite" className="text-xl font-semibold">
          Responsabilité
        </h2>
        <p className="mt-4 text-sm text-slate-700">
          Les informations publiées sur la fiche d’un salon — prestations, tarifs, durées,
          horaires, photographies — sont saisies et maintenues par le salon lui-même.
          L’éditeur n’en garantit ni l’exactitude ni l’actualité.
        </p>
        <p className="mt-3 text-sm text-slate-700">
          Un rendez-vous confirmé engage le client et le salon. L’annulation reste
          possible dans le délai fixé par chaque salon, indiqué au moment de la
          réservation puis rappelé dans le courriel de confirmation.
        </p>
      </section>

      <section aria-labelledby="propriete" className="mt-10">
        <h2 id="propriete" className="text-xl font-semibold">
          Propriété intellectuelle
        </h2>
        <p className="mt-4 text-sm text-slate-700">
          La structure du site et les éléments qui la composent sont protégés. Les
          contenus publiés par un salon — textes, photographies — restent la propriété de
          celui-ci, qui garantit détenir les droits nécessaires à leur diffusion.
        </p>
      </section>

      <section aria-labelledby="donnees" className="mt-10">
        <h2 id="donnees" className="text-xl font-semibold">
          Données personnelles et cookies
        </h2>
        <p className="mt-4 text-sm text-slate-700">
          Le traitement des données personnelles, les durées de conservation et les
          modalités d’exercice de vos droits sont détaillés dans la{' '}
          <Link href="/confidentialite" className="underline">
            politique de confidentialité
          </Link>
          .
        </p>
        <p className="mt-3 text-sm text-slate-700">
          Le site ne dépose qu’un cookie de session, strictement nécessaire au maintien de
          la connexion. Aucun traceur publicitaire ni outil de mesure d’audience tiers
          n’est utilisé : aucun consentement préalable n’est donc requis à ce titre.
        </p>
      </section>

      <section aria-labelledby="litiges" className="mt-10">
        <h2 id="litiges" className="text-xl font-semibold">
          Litiges et médiation
        </h2>
        <p className="mt-4 text-sm text-slate-700">
          Une réclamation relative à une prestation doit être adressée au salon concerné.
          Pour toute réclamation portant sur le service lui-même, écrire à{' '}
          <ToFill>adresse de contact</ToFill>.
        </p>
        <p className="mt-3 text-sm text-slate-700">
          Conformément à l’article L. 612-1 du code de la consommation, le consommateur
          peut recourir gratuitement à un médiateur :{' '}
          <ToFill>nom et coordonnées du médiateur de la consommation</ToFill>.
        </p>
      </section>

      <p className="mt-12 text-sm">
        <Link href="/" className="underline">
          Retour à l’accueil
        </Link>
      </p>
    </main>
  )
}
