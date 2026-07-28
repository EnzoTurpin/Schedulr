import type { Metadata } from 'next'
import Link from 'next/link'
import { RETENTION } from '@/features/privacy/dataSubject'

export const metadata: Metadata = {
  title: 'Politique de confidentialité',
  description:
    'Quelles données Schedulr collecte, pourquoi, combien de temps, et comment exercer vos droits.',
}

/**
 * Politique de confidentialité.
 *
 * ⚠️ Ce texte décrit fidèlement ce que fait le code, mais il n'a **pas** été
 * relu par un juriste. Les mentions obligatoires — identité du responsable de
 * traitement, coordonnées du délégué à la protection des données, autorité de
 * contrôle — doivent être complétées avant toute mise en ligne réelle.
 */
export default function PrivacyPage() {
  return (
    <main id="contenu" className="mx-auto max-w-2xl px-6 py-12">
      <h1 className="text-3xl font-semibold tracking-tight">
        Politique de confidentialité
      </h1>

      <p className="mt-4 rounded-md bg-amber-50 px-4 py-3 text-sm text-amber-900">
        Ce document doit être complété par le responsable de traitement avant toute
        exploitation : identité de l’éditeur, coordonnées de contact et autorité de
        contrôle compétente.
      </p>

      <section aria-labelledby="donnees" className="mt-10">
        <h2 id="donnees" className="text-xl font-semibold">
          Données collectées
        </h2>
        <dl className="mt-4 space-y-4 text-sm">
          <div>
            <dt className="font-medium">Compte</dt>
            <dd className="text-slate-700">
              Adresse électronique, nom, prénom, numéro de téléphone facultatif. Le mot de
              passe n’est jamais conservé en clair : seule une empreinte Argon2id est
              stockée.
            </dd>
          </div>
          <div>
            <dt className="font-medium">Rendez-vous</dt>
            <dd className="text-slate-700">
              Salon, date, prestations, coiffeur, montant, message éventuel laissé au
              salon.
            </dd>
          </div>
          <div>
            <dt className="font-medium">Notifications</dt>
            <dd className="text-slate-700">
              Date d’envoi, canal et résultat. Le destinataire est stocké sous forme
              d’empreinte : ni votre adresse ni votre numéro n’apparaissent dans ce
              journal.
            </dd>
          </div>
          <div>
            <dt className="font-medium">Consentements</dt>
            <dd className="text-slate-700">
              Chaque décision relative aux SMS est datée et conservée, afin de pouvoir en
              justifier.
            </dd>
          </div>
        </dl>
      </section>

      <section aria-labelledby="finalites" className="mt-10">
        <h2 id="finalites" className="text-xl font-semibold">
          Pourquoi ces données
        </h2>
        <ul className="mt-4 list-disc space-y-2 pl-5 text-sm text-slate-700">
          <li>
            Gérer vos rendez-vous et permettre au salon de préparer votre venue —
            exécution du contrat.
          </li>
          <li>
            Vous envoyer confirmations et rappels — exécution du contrat pour le courriel,
            consentement pour les SMS.
          </li>
          <li>
            Établir les statistiques d’activité du salon — intérêt légitime du salon à
            piloter son établissement.
          </li>
        </ul>
        <p className="mt-4 text-sm text-slate-700">
          Vos données ne sont ni vendues, ni cédées à des fins publicitaires.
        </p>
      </section>

      <section aria-labelledby="destinataires" className="mt-10">
        <h2 id="destinataires" className="text-xl font-semibold">
          Qui y accède
        </h2>
        <p className="mt-4 text-sm text-slate-700">
          Seul le salon chez lequel vous prenez rendez-vous accède à vos rendez-vous le
          concernant. Les salons sont cloisonnés entre eux : un établissement ne voit
          jamais l’activité d’un autre.
        </p>
        <p className="mt-3 text-sm text-slate-700">
          Deux sous-traitants interviennent dans l’envoi des messages : Resend pour les
          courriels, Twilio pour les SMS. Ils reçoivent uniquement les informations
          nécessaires à l’acheminement.
        </p>
      </section>

      <section aria-labelledby="duree" className="mt-10">
        <h2 id="duree" className="text-xl font-semibold">
          Combien de temps
        </h2>
        <ul className="mt-4 list-disc space-y-2 pl-5 text-sm text-slate-700">
          <li>Rendez-vous : {RETENTION.appointmentYears} ans après leur date.</li>
          <li>Journal des envois : {RETENTION.notificationMonths} mois.</li>
          <li>Journal des opérations : {RETENTION.auditYears} ans.</li>
          <li>
            Compte supprimé : les données identifiantes sont effacées immédiatement ; les
            rendez-vous restants sont anonymes.
          </li>
        </ul>
      </section>

      <section aria-labelledby="droits" className="mt-10">
        <h2 id="droits" className="text-xl font-semibold">
          Vos droits
        </h2>
        <p className="mt-4 text-sm text-slate-700">
          Depuis votre espace, vous pouvez à tout moment télécharger l’ensemble de vos
          données et supprimer votre compte.
        </p>
        <p className="mt-3 text-sm text-slate-700">
          La suppression efface votre identité et vos coordonnées. Les rendez-vous passés
          sont conservés sous forme anonyme : le salon doit pouvoir justifier son
          activité, sans que vous y soyez identifiable.
        </p>
        <p className="mt-4 text-sm">
          <Link href="/mon-compte" className="text-brand-700 underline">
            Gérer mes données
          </Link>
        </p>
      </section>

      <section aria-labelledby="securite" className="mt-10">
        <h2 id="securite" className="text-xl font-semibold">
          Sécurité
        </h2>
        <p className="mt-4 text-sm text-slate-700">
          Les échanges sont chiffrés. Les mots de passe sont hachés avec Argon2id, les
          jetons de session sont stockés hachés, et une déconnexion prend effet
          immédiatement. Aucune donnée personnelle n’est écrite dans les journaux
          techniques.
        </p>
      </section>
    </main>
  )
}
