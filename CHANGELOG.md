# Changelog

Toutes les évolutions notables de ce projet sont consignées dans ce fichier.

Le format suit [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/) et le
versionnage respecte [SemVer](https://semver.org/lang/fr/).

## [Unreleased]

### Fixed

- **Faille XSS stockée sur la fiche salon publique.** `JSON.stringify` n'échappe
  pas la séquence `</script>` : le parseur HTML ferme la balise dès qu'il la
  rencontre, y compris au milieu d'une chaîne JSON. Les champs sérialisés dans
  les données structurées — nom du salon, description, biographies — étant
  saisis librement par le gérant, celui-ci pouvait exécuter du script chez tout
  visiteur de sa fiche. Signalée par l'audit de sécurité.
- **Les pages publiques étaient interdites d'indexation.** La directive
  `noindex` posée en phase 0 n'avait jamais été levée, alors que le
  référencement des fiches salon est le principal canal d'acquisition
  (ADR-0001). Score Lighthouse SEO : 54 → 100.
- `listFailedNotifications` rejoue désormais son autorisation au lieu de s'en
  remettre à l'appelant.
- Comparaison du secret de cron à temps constant.

### Added

- `robots.txt`, `sitemap.xml` et favicon.
- ADR-0006 : stockage des images par service objet, avec téléversement direct.

### Mesures

- Lighthouse sur la fiche salon : **100 / 100 / 100 / 100** (performance,
  accessibilité, bonnes pratiques, référencement).
- Audit de sécurité : cloisonnement multi-tenant, autorisations et
  authentification sans faille exploitable identifiée.

## [1.0.0] - 2026-07-29

### Added — phase 8 : conformité et durcissement

- **Droits des personnes** : export des données au format JSON depuis l'espace
  client, et suppression de compte par anonymisation — l'identité est effacée,
  les rendez-vous subsistent sans être rattachables à quiconque.
- **Durées de conservation** appliquées par un job quotidien : rendez-vous
  3 ans, journal des envois 1 an, journal d'audit 3 ans.
- **Politique de confidentialité** publique, décrivant les données collectées,
  leurs finalités, leurs destinataires et les durées de conservation.
- **Limitation de débit** sur la connexion, l'inscription et la réservation.
- **Politique de sécurité de contenu** complète, plus HSTS en production.
- Documentation d'exploitation : sauvegarde, restauration vérifiée, tâches
  planifiées, incidents courants.
- 542 tests unitaires et d'intégration, 54 parcours de bout en bout.

### Security

- La suppression de compte révoque immédiatement toutes les sessions.
- L'export de données n'expose jamais l'empreinte du mot de passe, ni les
  notes internes du salon — elles appartiennent au salon, pas au client.
- La route de purge est protégée par le même secret que les rappels : une
  purge déclenchée par un tiers détruirait des données.

### Notes techniques

- **La limitation de débit est en mémoire du processus.** En déploiement
  multi-instances, la limite effective est multipliée par le nombre
  d'instances. Un magasin partagé (Redis) est nécessaire à l'échelle ; le
  compromis est assumé pour cette version.
- **Index vérifiés** sur 90 000 rendez-vous : les trois requêtes critiques —
  agenda du salon, disponibilités d'un coiffeur, rendez-vous d'un client —
  passent toutes par un index.

### Added — phase 7 : back-office et statistiques

- Statistiques du salon : chiffre d'affaires réalisé et attendu, taux de
  présence, taux de remplissage, prestations les plus demandées, activité par
  coiffeur, sur une période choisie.
- Remontée au gérant des notifications restées en échec définitif.
- Export CSV des rendez-vous, lisible par un tableur français.
- Back-office plateforme : création et suspension de salons, liste des comptes,
  journal d'audit, indicateurs globaux. Toutes les listes sont paginées.
- 510 tests unitaires et d'intégration, 46 parcours de bout en bout.

### Security

- L'export CSV neutralise l'injection de formule : une cellule commençant par
  `=`, `+`, `-` ou `@` est interprétée par le tableur, et un nom de client
  malveillant exécuterait du code à l'ouverture du fichier par le gérant.
- Les exports ne sont jamais mis en cache : ils contiennent des données
  personnelles.

### Fixed

- Les listes de définition des tableaux de bord contenaient un `<p>` dans un
  `<div>` enfant de `<dl>`, structure invalide signalée par axe.

### Added — phase 6 : notifications

- Courriels transactionnels (Resend) : confirmation, annulation, rappel J-1.
  HTML et texte brut, contenu échappé.
- SMS (Twilio) sur les mêmes évènements, soumis à un consentement explicite et
  portant la mention d'opposition.
- **Idempotence garantie par la base** : la clé
  `rendez-vous:gabarit:canal` est réservée avant l'envoi, si bien qu'un job
  rejoué ou deux exécutions concurrentes ne produisent jamais de doublon.
- Rappel J-1 déclenché toutes les heures sur une fenêtre glissante de deux
  heures, route protégée par un secret partagé.
- Reprise sur échec : trois tentatives, seuls les incidents transitoires sont
  rejoués. Les échecs définitifs sont consultables par le salon.
- Registre des consentements historisé, exigé par le RGPD.
- 463 tests unitaires et d'intégration, 35 parcours de bout en bout.

### Security

- Le journal des envois ne contient **aucune donnée personnelle** : le
  destinataire y est stocké haché en SHA-256.
- `CRON_SECRET` devient obligatoire dès que les notifications sont activées :
  sans lui la route de rappels serait ouverte, et chaque SMS est facturé.

### Dependencies

- Ajout de `resend` et `twilio` en dépendances de production.

### Added — phase 5 : configuration du salon

- Catalogue : catégories, prestations, durées, tarifs, marges de préparation et
  de remise en état. Une prestation retirée disparaît de la réservation sans
  rompre les rendez-vous passés qui la référencent.
- Horaires d'ouverture éditables semaine par semaine, coupures déjeuner
  comprises, avec refus des plages incohérentes ou qui se chevauchent.
- Fermetures exceptionnelles, avec comptage des rendez-vous qu'elles rendraient
  caducs.
- Équipe : création de membres sans compte, rôles, couleur d'agenda, horaires
  individuels, congés et affectation des prestations. Désactiver un membre
  révoque immédiatement toutes ses sessions.
- Fiche du salon et règles de réservation : délai minimum, horizon,
  granularité, délai d'annulation, avec validation des combinaisons
  impossibles.
- 413 tests unitaires et d'intégration, 30 parcours de bout en bout.

### Fixed

- Les prestations n'étaient exposées au public qu'à travers leurs catégories.
  `categoryId` étant nullable — et l'écran de configuration proposant
  explicitement « sans catégorie » — une telle prestation restait invisible sur
  la fiche salon comme dans le tunnel, donc non réservable.

### Added — phase 4 : agenda professionnel

- Grille d'agenda multi-coiffeurs développée en interne (ADR-0005) : géométrie
  en fonctions pures, chevauchements répartis en colonnes, y compris sur une
  chaîne transitive.
- Navigation clavier complète : flèches pour déplacer, Maj + flèches pour
  changer de coiffeur, Entrée pour ouvrir le détail.
- Rendez-vous pris au comptoir ou par téléphone, pour un client sans compte.
  Le salon peut réserver hors des créneaux publics.
- Déplacement et redimensionnement, avec mise à jour optimiste **réversible** :
  le bloc retourne à sa place si la contrainte d'exclusion refuse l'opération.
- Statuts honoré, absent et annulé, journalisés avec leur transition.
- Fiche client vue du salon : historique limité à ce salon, compteur de
  no-shows, note interne invisible du client.
- 14 tests de bout en bout au total, 371 tests unitaires et d'intégration.

### Fixed

- Les 87 tests d'intégration échouaient en CI : le bloc `env` de Vitest écrase
  l'environnement du processus, si bien que l'URL déduite de `USER` remplaçait
  celle du workflow. Un garde-fou refuse désormais toute base dont le nom ne
  contient pas « test », pour qu'un `.env` chargé localement ne fasse pas
  effacer la base de développement.
- La grille portait `role="grid"`, qui impose des enfants `row` et `gridcell`
  absents de cette disposition — violation WCAG détectée par axe. Remplacé par
  `role="group"`.

### Added — phase 3 : réservation client

- Recherche publique de salons et fiche salon rendue côté serveur, avec données
  structurées schema.org (`HairSalon`) — canal d'acquisition principal.
- Tunnel de réservation en quatre étapes : prestations, coiffeur (ou « peu
  importe »), créneau, confirmation.
- Création de rendez-vous : durées et prix recalculés côté serveur, créneau
  revérifié cache désactivé juste avant l'écriture, conflit concurrent traduit
  en message actionnable.
- Espace client : rendez-vous à venir, historique paginé, annulation dans le
  délai fixé par le salon.
- Journal d'audit à l'annulation, sans donnée personnelle.
- Playwright : 7 tests de bout en bout, dont le parcours complet réserver →
  confirmer → annuler, un contrôle d'accessibilité axe sur quatre écrans et un
  parcours clavier. Ajoutés à la CI.
- 312 tests unitaires et d'intégration.

### Fixed

- Le message d'erreur disparaissait lorsqu'une réservation échouait sur un
  conflit : le rechargement des créneaux réinitialisait l'alerte, si bien que la
  liste se rafraîchissait sans explication. Détecté par le test de bout en bout.
- La détection de dérive de schéma était **silencieusement sautée** en CI : elle
  cherchait `prisma/migrations` alors que le schéma multi-fichiers place les
  migrations dans `prisma/schema/migrations`. L'étape échoue désormais si le
  dossier est absent, au lieu de se désactiver toute seule.

### Added — phase 2 : moteur de disponibilité

- Algèbre d'intervalles pure (`intervals.ts`) : normalisation, intersection,
  soustraction, marges, découpe en créneaux. Convention semi-ouverte `[début,
fin)`, alignée sur la contrainte d'exclusion PostgreSQL.
- Couche fuseau horaire (`time.ts`) : conversion des horaires récurrents
  exprimés en minutes locales vers des instants absolus, avec traitement
  explicite des changements d'heure.
- Moteur (`engine.ts`) : composition horaires salon ∩ horaires coiffeur −
  congés − fermetures − rendez-vous, puis découpe. Résolution « n'importe quel
  coiffeur » par charge, égalités tranchées de façon déterministe.
- Chargement des données en une requête par famille, via le client cloisonné
  par salon (ADR-0002).
- Cache court des créneaux publics, invalidable par salon. Les agendas
  professionnels ne sont jamais servis depuis le cache.
- 144 tests dédiés — couverture du module : 99,2 % des lignes, 100 % des
  fonctions. Seuil de couverture spécifique appliqué en CI.

### Fixed

- Retrait de l'override `brace-expansion >= 5.0.8` posé en phase 0 : la
  branche 5.x rompt l'API attendue par `minimatch`, ce qui cassait
  `pnpm test:coverage` (`brace_expansion_1.default is not a function`). Le
  correctif n'existe pas sur une branche compatible ; l'exposition est limitée
  à ESLint et à la couverture Vitest, sur des motifs glob que nous écrivons
  nous-mêmes. La CI bloque désormais sur `pnpm audit --prod` et signale le
  reste sans bloquer.

### Added — phase 1 : modèle de données et authentification

- Schéma Prisma complet : 18 tables, 8 énumérations, découpé par domaine dans
  `prisma/schema/`
- Migration initiale et migration SQL manuelle posant la contrainte d'exclusion
  anti double-réservation (ADR-0004)
- Client Prisma cloisonné par salon (`forSalon`) et accès inter-salons explicite
  (`crossSalon`), conformément à l'ADR-0002
- Autorisations : `can()` / `assertCan()`, matrice à 18 actions et 5 rôles,
  distinction 404 / 403 pour ne pas révéler l'existence d'une ressource d'un
  autre salon
- Authentification par mot de passe (Argon2id) avec sessions persistées en base
  et révocation immédiate ; jeton de session stocké haché
- Espaces client, professionnel et administration, middleware de redirection
- Seed déterministe : 2 salons, 6 coiffeurs, 15 prestations, 40 rendez-vous
- 90 tests (unitaires et intégration)

### Changed

- Tous les champs `DateTime` passent en `@db.Timestamptz(3)`. Prisma les mappait
  vers `timestamp` **sans fuseau**, ce qui perdait le décalage horaire et rendait
  la contrainte de l'ADR-0004 impossible à poser (expression non immutable).
- Variables d'environnement consolidées dans `.env` — Prisma ne lit pas
  `.env.local`, contrairement à Next.js.

### Fixed

- Test de concurrence instable : `resetDatabase()` utilisait `TRUNCATE`, dont le
  verrou ACCESS EXCLUSIVE attendait les connexions résiduelles des autres
  fichiers de test. Remplacé par `DELETE`.

### Added

- Socle technique : Next.js 15, TypeScript strict, Tailwind CSS 4, Prisma 6,
  PostgreSQL 16
- Validation des variables d'environnement au démarrage, avec coupe-circuit
  des notifications (`NOTIFICATIONS_ENABLED`)
- Intégration continue : lint, formatage, types, tests, build, audit des
  dépendances, détection de dérive du schéma Prisma
- `docker-compose.yml` pour un PostgreSQL de développement reproductible, avec
  création des bases annexes et de l'extension `btree_gist`
- Plan d'action et cinq décisions d'architecture documentées (`docs/`)
- En-têtes de sécurité HTTP de base (la CSP complète est prévue en phase 8)

### Security

- Trois `pnpm.overrides` posés pour corriger des vulnérabilités transitives que
  les dépendances directes ne permettaient pas encore de résoudre :
  - `sharp >= 0.35.0` — CVE-2026-33327/33328/35590/35591 héritées de libvips,
    atteintes via `next` (optimisation d'images). `next@15.5` déclare `^0.34.3` :
    l'override anticipe sa mise à jour et devra être retiré ensuite.
  - `postcss >= 8.5.18` — lecture de fichier arbitraire et traversée de chemin
    via `sourceMappingURL`, atteintes via `next`.
  - `brace-expansion >= 5.0.8` — déni de service par expansion non bornée,
    atteinte via l'outillage de développement (ESLint, couverture Vitest).
    Ces trois overrides sont à réexaminer à chaque montée de version de `next` :
    un override laissé en place masque les correctifs amont.

### Notes techniques

- La configuration Prisma via `package.json#prisma` est dépréciée et sera
  supprimée dans Prisma 7 : la migration vers `prisma.config.ts` reste à faire.
  Elle a été différée car ce fichier modifie le chargement automatique des
  fichiers `.env`, ce qui demande une vérification dédiée.
