# Changelog

Toutes les évolutions notables de ce projet sont consignées dans ce fichier.

Le format suit [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/) et le
versionnage respecte [SemVer](https://semver.org/lang/fr/).

## [1.6.0] - 2026-07-29

### Added

- **Mentions légales** (`/mentions-legales`), obligatoires pour un service en
  ligne et jusqu'ici absentes. Le document est un gabarit : les informations
  d'identification de l'éditeur et de l'hébergeur sont marquées « À COMPLÉTER »
  et visibles, plutôt qu'inventées.
- La **recherche publique porte aussi sur les prestations** : on cherche autant
  « un balayage » qu'un salon par son nom. Les prestations désactivées sont
  ignorées — proposer un salon pour une prestation qu'il ne fait plus mènerait
  à un tunnel sans issue.

### Changed

- Les écrans connectés passent de 896 à 1152 pixels de large. L'agenda
  multi-coiffeurs et les tableaux d'administration défilaient horizontalement
  dès quatre colonnes, y compris sur grand écran.

## [1.5.0] - 2026-07-29

### Added

- **Vérification de l'adresse électronique.** N'importe qui pouvait jusqu'ici
  s'inscrire avec l'adresse d'un tiers et recevoir ses notifications de
  rendez-vous : la colonne `emailVerified` n'était jamais renseignée ni lue.
  Tant que l'adresse n'est pas confirmée, **seuls les courriels sont
  suspendus** — bloquer la connexion enfermerait dehors quiconque a saisi son
  adresse de travers.
- **Changement de mot de passe**, qui ferme toutes les sessions. C'est le point
  essentiel : changer son mot de passe après une compromission ne sert à rien
  si la session de l'intrus reste ouverte.
- **Fermeture de toutes les sessions** depuis le profil. `revokeAllSessions`
  existait et était testée, sans aucune commande pour l'atteindre.
- **Alerte au titulaire** lorsqu'une inscription est tentée sur son adresse.
  L'auteur de la tentative n'apprend rien — ce serait un moyen d'énumérer les
  comptes — mais le titulaire légitime, si.

### Security

- Les jetons à usage unique portent désormais un usage explicite. Sans lui, un
  lien de confirmation d'adresse ouvrait une session, et demander un lien de
  connexion effaçait une vérification en cours : les deux partagent la même
  table.

## [1.4.0] - 2026-07-29

### Added

- **Navigation entre espaces** dans l'en-tête de l'espace connecté. Une même
  personne peut être cliente ici et gérante là ; passer de l'un à l'autre
  exigeait jusqu'ici de modifier l'URL. Les liens s'affichent selon les droits
  réels.
- Retour vers la liste des salons depuis l'agenda de l'un d'eux.
- **Pages d'erreur** : 404, erreur de rendu et erreur racine. L'application
  n'en avait aucune — un lien périmé affichait l'écran par défaut de Next.js,
  sans en-tête ni moyen de repartir.

### Changed

- La fiche publique d'un salon sans prestation, sans horaire ou sans coiffeur
  n'invite plus à réserver : le tunnel n'aurait proposé aucun créneau. Le
  numéro de téléphone du salon est proposé à la place, s'il est renseigné.
- Commentaires renvoyant à des phases de livraison désormais achevées.

## [1.3.0] - 2026-07-29

### Added

- **Écran de profil** (`/mon-compte/profil`) : prénom, nom et téléphone. Le
  numéro n'était saisissable nulle part, alors que la case de consentement aux
  SMS invitait à le renseigner « dans votre profil ». Tout le canal SMS —
  consentement, rappels J-1, quota mensuel — était de ce fait inaccessible aux
  clients disposant d'un compte.
- Le téléphone peut être donné dès l'inscription, sans y être obligatoire.

### Changed

- Les numéros sont normalisés au format E.164 attendu par Twilio :
  `06 12 34 56 78` devient `+33612345678`. Espaces, points, tirets et
  parenthèses sont acceptés — les refuser aurait fait échouer une saisie
  parfaitement lisible.
- La case de consentement renvoie vers le profil par un lien, au lieu de
  mentionner un écran inexistant.

## [1.2.0] - 2026-07-29

### Fixed

- **Un salon monté par l'interface ne pouvait accepter aucune réservation.** Le
  moteur de disponibilité croise les horaires d'ouverture du salon avec ceux de
  chaque membre, sans repli : un membre sans horaires propres n'était jamais
  proposé. Or rien ne permettait de les saisir. Les salons de démonstration
  masquaient le défaut, leur seed écrivant ces horaires directement en base. Un
  nouveau membre reprend désormais les horaires d'ouverture du salon, et
  l'écran d'équipe signale tout membre qui n'en a aucun.

### Added

- **Horaires individuels par membre**, éditables depuis l'écran d'équipe.
  `saveWorkingHoursAction` existait déjà mais n'était appelée par aucune
  interface.
- **Congés et absences par membre.** Même constat : le modèle, le moteur et les
  actions serveur étaient en place, sans écran pour les atteindre.
- Test de bout en bout montant un salon complet par l'interface — prestation,
  horaires, membre, affectation — puis réservant. Son absence est ce qui a
  laissé passer le défaut ci-dessus.

### Changed

- La grille de saisie d'une semaine est mutualisée entre les horaires
  d'ouverture et ceux des membres (`WeekEditor`). Ses libellés accessibles
  passent de « ouverture / fermeture » à « début / fin », valables dans les deux
  cas.
- `TeamPanel` dépassait les 490 lignes : le formulaire de fiche est extrait dans
  `MemberForm`.

## [1.1.0] - 2026-07-29

### Added

- **Connexion par lien à usage unique.** Une adresse suffit : le lien reçu par
  courriel ouvre la session, expire en quinze minutes et ne sert qu'une fois.
  Le jeton est stocké haché ; la réponse est identique que le compte existe ou
  non, pour ne pas permettre d'énumérer les comptes.
- **Invitations d'équipe.** Un gérant rattache un compte à une fiche de membre
  déjà créée — la fiche, ses horaires et ses rendez-vous préexistent à
  l'invitation. Le lien vise une adresse précise : transféré, il ne donne aucun
  accès.
- **Plafond mensuel de SMS par salon** (`smsMonthlyQuota`, 500 par défaut,
  réglable dans les paramètres). Seuls les envois réussis sont décomptés. Ferme
  le seul poste de dépense non maîtrisé du produit.

### Changed

- La destination mémorisée à la connexion conserve la chaîne de requête. Sans
  cela, une personne non connectée cliquant sur son lien d'invitation perdait
  le jeton en passant par le formulaire de connexion.
- ADR-0001 amendé : l'authentification est écrite à la main, Auth.js n'ayant
  jamais été installé. Son adaptateur Prisma impose le mode JWT avec les
  identifiants, ce qui aurait supprimé la révocation immédiate — la propriété
  même qui motivait des sessions en base.

### Security

- `safeRedirect` refuse désormais les chemins commençant par `/\`, que les
  navigateurs résolvent comme des URL absolues au même titre que `//`. Extrait
  dans `src/lib/auth/safeRedirect.ts` et couvert par des tests.
- La consommation d'un lien de connexion départage deux appels concurrents sur
  la suppression du jeton, et non sur sa lecture : un lien intercepté n'ouvre
  jamais deux sessions.

## [1.0.1] - 2026-07-29

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
