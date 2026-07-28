# Schedulr — Plan d'action

**Date** : 2026-07-27
**Statut** : Proposé — en attente de validation développeur
**Objet** : plateforme de réservation en ligne pour salons de coiffure (type Planity)

---

## 1. Décisions cadrées

| Sujet         | Décision                                                                                    | Conséquence principale                                         |
| ------------- | ------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| Stack         | Next.js 15 (App Router) + TypeScript, Prisma + PostgreSQL, Auth.js v5, Tailwind + shadcn/ui | Un seul déploiement, SSR pour le SEO des pages salon           |
| Périmètre     | Multi-salons (SaaS multi-tenant)                                                            | `salonId` sur **toute** table métier dès la première migration |
| Paiement      | Aucun en V1                                                                                 | `paymentStatus` présent mais figé à `NONE` ; Stripe en V2      |
| Notifications | Email (Resend) + SMS (Twilio)                                                               | Opt-in SMS explicite, budget par message, journal d'envoi      |

Fuseau de référence : **Europe/Paris**. Stockage des instants en UTC (`timestamptz`), horaires récurrents en minutes locales + `salon.timezone`.

---

## 2. Rôles et permissions

Deux niveaux : un rôle **global** porté par `User`, un rôle **par salon** porté par `SalonMember`.

```
User.role          : CLIENT | PLATFORM_ADMIN
SalonMember.role   : OWNER | MANAGER | STAFF
```

Un même `User` peut être client d'un salon A et coiffeur du salon B — d'où la séparation.

| Action                               | Client |   Staff    | Manager | Owner | Platform admin |
| ------------------------------------ | :----: | :--------: | :-----: | :---: | :------------: |
| Réserver / annuler **son** RDV       |   ✅   |     ✅     |   ✅    |  ✅   |       ✅       |
| Voir **son** agenda                  |   —    |     ✅     |   ✅    |  ✅   |       ✅       |
| Voir l'agenda **global** du salon    |   —    |  lecture   |   ✅    |  ✅   |       ✅       |
| Créer / déplacer un RDV pour autrui  |   —    | son agenda |   ✅    |  ✅   |       ✅       |
| Gérer services, tarifs, durées       |   —    |     —      |   ✅    |  ✅   |       ✅       |
| Gérer horaires salon & congés équipe |   —    | ses congés |   ✅    |  ✅   |       ✅       |
| Inviter / désactiver un membre       |   —    |     —      |    —    |  ✅   |       ✅       |
| Modifier la fiche salon, photos      |   —    |     —      |   ✅    |  ✅   |       ✅       |
| Statistiques du salon                |   —    |     —      |   ✅    |  ✅   |       ✅       |
| Créer / suspendre un salon           |   —    |     —      |    —    |   —   |       ✅       |
| Consulter les logs d'audit           |   —    |     —      |    —    | salon |   plateforme   |

**Règle non négociable** : le middleware Next.js ne fait que rediriger. Chaque route handler et chaque server action revérifie l'autorisation côté serveur via un helper unique `assertCan(session, action, resource)`. Aucune décision d'accès basée sur un champ envoyé par le client.

---

## 3. Modèle de données

Extrait du `schema.prisma` cible (les champs d'audit `createdAt`/`updatedAt` sont omis pour la lisibilité).

```prisma
model User {
  id            String    @id @default(cuid())
  email         String    @unique
  emailVerified DateTime?
  phone         String?
  firstName     String
  lastName      String
  role          UserRole  @default(CLIENT)
  memberships   SalonMember[]
  appointments  Appointment[] @relation("clientAppointments")
  deletedAt     DateTime?     // anonymisation RGPD, pas de hard delete
}

model Salon {
  id        String  @id @default(cuid())
  slug      String  @unique          // /salon/coiffure-martin-lyon
  name      String
  timezone  String  @default("Europe/Paris")
  address   String
  city      String
  postalCode String
  lat       Float?
  lng       Float?
  isActive  Boolean @default(false)  // activé par le platform admin
  bookingLeadTimeMin Int @default(120)   // délai mini avant un RDV
  bookingHorizonDays Int @default(60)    // horizon max de réservation
  slotStepMin        Int @default(15)    // granularité des créneaux
  cancellationDeadlineHours Int @default(24)
  members   SalonMember[]
  services  Service[]
  openingHours OpeningHour[]
  closures  Closure[]
  appointments Appointment[]
}

model SalonMember {
  id       String    @id @default(cuid())
  salonId  String
  userId   String?                      // null = coiffeur sans compte (ressource)
  role     SalonRole
  displayName String                    // affiché au client
  bio      String?
  avatarUrl String?
  color    String                       // couleur de sa colonne d'agenda
  isBookable Boolean @default(true)     // un manager peut ne pas être réservable
  isActive Boolean @default(true)
  services StaffService[]
  workingHours WorkingHour[]
  timeOff  TimeOff[]
  appointments Appointment[]
  @@unique([salonId, userId])
}

model Service {
  id          String @id @default(cuid())
  salonId     String
  categoryId  String?
  name        String
  description String?
  durationMin Int
  bufferBeforeMin Int @default(0)
  bufferAfterMin  Int @default(0)       // ex. nettoyage du poste
  priceCents  Int
  isActive    Boolean @default(true)
  staff       StaffService[]
}

model StaffService {          // qui fait quoi, avec override possible
  memberId    String
  serviceId   String
  durationMin Int?            // null => durée du service
  priceCents  Int?            // null => prix du service
  @@id([memberId, serviceId])
}

model OpeningHour {           // horaires du salon, récurrents
  id        String @id @default(cuid())
  salonId   String
  dayOfWeek Int                // 0 = dimanche
  startMin  Int                // minutes depuis minuit, heure locale
  endMin    Int
}

model WorkingHour {           // horaires d'un membre, récurrents
  id       String @id @default(cuid())
  memberId String
  dayOfWeek Int
  startMin Int
  endMin   Int
}

model TimeOff {               // congé, pause, absence ponctuelle
  id       String @id @default(cuid())
  memberId String
  startAt  DateTime
  endAt    DateTime
  reason   String?
}

model Closure {               // fermeture exceptionnelle du salon
  id      String @id @default(cuid())
  salonId String
  startAt DateTime
  endAt   DateTime
  reason  String?
}

model Appointment {
  id         String   @id @default(cuid())
  salonId    String
  memberId   String                     // le coiffeur
  clientId   String?                    // null = client hors compte (walk-in)
  guestName  String?                    // renseigné si clientId null
  guestPhone String?
  guestEmail String?
  startAt    DateTime                   // UTC
  endAt      DateTime                   // = startAt + Σ durées + buffers
  status     AppointmentStatus @default(CONFIRMED)
  source     AppointmentSource @default(ONLINE)   // ONLINE | SALON | PHONE
  paymentStatus PaymentStatus @default(NONE)      // réservé pour la V2
  clientNote String?
  staffNote  String?                    // non visible du client
  cancelledAt DateTime?
  cancelledBy String?
  items      AppointmentItem[]
  @@index([salonId, startAt])
  @@index([memberId, startAt])
}

model AppointmentItem {       // un RDV = 1..n prestations (couleur + coupe)
  id            String @id @default(cuid())
  appointmentId String
  serviceId     String
  nameSnapshot  String        // gel du libellé/prix au moment de la résa
  durationMin   Int
  priceCents    Int
  position      Int
}

model NotificationLog {
  id        String @id @default(cuid())
  appointmentId String?
  channel   NotificationChannel        // EMAIL | SMS
  template  String                     // booking_confirmed, reminder_j1, ...
  recipient String                     // hashé en base, jamais en clair dans les logs
  status    NotificationStatus         // QUEUED | SENT | FAILED
  providerId String?
  error     String?
  idempotencyKey String @unique        // appointmentId:template
  sentAt    DateTime?
}

model AuditLog {
  id        String @id @default(cuid())
  salonId   String?
  actorId   String?
  action    String                      // appointment.cancelled, member.invited
  targetType String
  targetId  String
  metadata  Json
  createdAt DateTime @default(now())
}
```

**Consentements** (table `ConsentRecord` ou champs sur `User`) : `marketingEmail`, `marketingSms`, `transactionalSms`, chacun avec date et origine. Le transactionnel (confirmation, rappel) est légitime ; le marketing exige un opt-in distinct.

### Choix à noter

- **Coiffeur sans compte** : `SalonMember.userId` est nullable. Un salon peut créer la fiche d'un coiffeur et lui envoyer une invitation plus tard. Évite de bloquer l'onboarding.
- **Client sans compte** : `Appointment.clientId` nullable + champs invité, pour les RDV pris par téléphone ou au comptoir. La réservation en ligne, elle, exige un compte (traçabilité et annulation).
- **Snapshot des prix** dans `AppointmentItem` : changer un tarif ne doit jamais réécrire l'historique.
- **Pas de hard delete** sur `User` : anonymisation (`deletedAt` + écrasement des PII), les RDV passés restent pour la comptabilité du salon.

---

## 4. Le cœur technique : moteur de disponibilité

C'est la pièce la plus risquée du projet. Elle est isolée dans `src/features/availability/` et **testée en priorité**, sans dépendance à Prisma (fonctions pures prenant les données en entrée) pour être testable exhaustivement.

### Algorithme

```
slots(salon, serviceIds[], memberId | ANY, jour) :
  1. duration  = Σ StaffService.durationMin ?? Service.durationMin
     padStart  = buffer du 1er service, padEnd = buffer du dernier
  2. pour chaque membre candidat (ANY => tous ceux qui font TOUS les services) :
       windows = WorkingHour(jour) ∩ OpeningHour(jour)
       windows = windows − TimeOff − Closure
       busy    = Appointment(status ∈ {PENDING, CONFIRMED}) élargis des buffers
       free    = windows − busy
       slots   = découpe(free, pas = salon.slotStepMin, largeur = padStart+duration+padEnd)
  3. filtres : start ≥ now + bookingLeadTimeMin
               start ≤ now + bookingHorizonDays
  4. ANY => union par instant de départ, un membre retenu par créneau
            (le moins chargé du jour, tie-break déterministe sur l'id)
```

### Fuseaux horaires et heure d'été

Les horaires récurrents sont des **minutes locales**, jamais des instants. La conversion local → UTC se fait au calcul avec `date-fns-tz` (ou Luxon) en utilisant `salon.timezone`. Deux tests obligatoires : le dimanche de passage à l'heure d'été (une journée de 23 h, un créneau de 2 h 30 n'existe pas) et celui du retour à l'heure d'hiver (25 h, une heure locale ambiguë).

### Anti double-réservation

La vérification applicative ne suffit pas : deux requêtes simultanées peuvent valider le même créneau. On pose la garantie **dans PostgreSQL**.

```sql
CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE "Appointment"
  ADD COLUMN period tstzrange
  GENERATED ALWAYS AS (tstzrange("startAt", "endAt", '[)')) STORED;

ALTER TABLE "Appointment"
  ADD CONSTRAINT appointment_no_overlap
  EXCLUDE USING gist ("memberId" WITH =, period WITH &&)
  WHERE (status IN ('PENDING', 'CONFIRMED'));
```

Point d'attention : Prisma ne génère pas les colonnes générées ni les contraintes d'exclusion. Il faut une **migration SQL écrite à la main** et déclarer la colonne en `Unsupported("tstzrange")? @ignore` pour que les migrations suivantes ne la suppriment pas. À vérifier après chaque `prisma migrate dev` (`prisma migrate diff` en CI pour détecter une dérive).

Côté applicatif : intercepter l'erreur Postgres `23P01` et répondre `409 Conflict` avec un message « ce créneau vient d'être pris », plus un rafraîchissement des créneaux dans l'UI. Un test d'intégration doit lancer deux réservations concurrentes et vérifier qu'exactement une passe.

### Performance

Le calcul se fait sur une fenêtre bornée (7 jours max par requête), avec une seule requête SQL par salon récupérant RDV + absences de la période. Cache court (30–60 s) sur les créneaux publics, invalidé à chaque écriture de RDV sur le salon concerné.

---

## 5. Vues calendrier

Trois vues attendues :

1. **Agenda personnel** — jour / semaine, un seul coiffeur.
2. **Agenda global** — journée en colonnes, une colonne par coiffeur (vue « planning salon »).
3. **Vue client** — sélecteur de créneaux, pas un calendrier d'édition.

**Attention licence** : la vue multi-ressources de FullCalendar (`resourceTimeGrid`, `resourceTimeline`) fait partie de FullCalendar **Premium**, sous licence commerciale payante — à vérifier avant tout engagement. `react-big-calendar` est MIT mais n'a pas de vue ressources native.

**Recommandation** : construire la grille en CSS Grid maison (~4–6 j de travail), positionnement absolu des blocs sur un axe temporel. Contrôle total, aucune licence, aucun poids de bibliothèque, et le drag & drop se fait avec `@dnd-kit/core` (MIT). Le composant reste sous notre maîtrise, ce qui compte pour la fonction centrale du produit.

Interactions de l'agenda pro : créer par clic-glisser sur un créneau vide, déplacer/redimensionner par drag & drop (avec revalidation serveur + rollback optimiste en cas de conflit), clic sur un RDV pour le panneau de détail, navigation clavier obligatoire (WCAG 2.1 AA : tout ce qui est faisable à la souris doit l'être au clavier).

---

## 6. Arborescence cible

```
Schedulr/
├── .claude/agents/                    # déjà en place
├── .github/workflows/ci.yml
├── docs/
│   ├── plan-action.md                 # ce fichier
│   └── adr/
├── prisma/
│   ├── schema.prisma
│   ├── migrations/
│   └── seed.ts
├── public/
├── src/
│   ├── app/
│   │   ├── (public)/                  # vitrine + réservation
│   │   │   ├── page.tsx               # recherche de salons
│   │   │   ├── salon/[slug]/page.tsx  # fiche salon (SEO, SSR)
│   │   │   └── reserver/[slug]/       # tunnel de réservation
│   │   ├── (auth)/                    # connexion, inscription
│   │   ├── (client)/mon-compte/       # RDV, historique, profil
│   │   ├── (pro)/pro/[salonSlug]/     # agenda, équipe, services, stats
│   │   ├── (admin)/admin/             # back-office plateforme
│   │   └── api/
│   ├── components/                    # UI réutilisable (PascalCase)
│   ├── features/
│   │   ├── availability/              # moteur de créneaux (pur)
│   │   ├── booking/                   # tunnel + création de RDV
│   │   ├── calendar/                  # grille, drag & drop
│   │   ├── salon/
│   │   ├── staff/
│   │   └── notifications/
│   ├── hooks/
│   ├── lib/                           # auth, db, rbac, dates, validation
│   ├── services/                      # Resend, Twilio, géocodage
│   ├── types/
│   └── constants/
├── tests/
│   ├── unit/
│   ├── integration/
│   └── e2e/
├── .env.example
└── CLAUDE.md
```

---

## 7. Phases de livraison

Estimations en jours-homme pour un développeur seul. Chaque phase se termine par une PR revue (`code-reviewer`) et laisse l'application déployable.

### Phase 0 — Fondations (3–4 j)

- `create-next-app` TypeScript, Tailwind, shadcn/ui, ESLint + Prettier
- Prisma + Postgres local (Docker) et Neon en préproduction
- CI GitHub Actions : lint, typecheck, tests, `prisma migrate diff` (détection de dérive)
- `.env.example` complet + validation des variables au démarrage (schéma Zod, échec immédiat si manquant)
- Validation des ADR 0001 à 0005 (voir `docs/adr/`)

**Fait quand** : `pnpm dev` démarre, la CI est verte sur une PR vide.

### Phase 1 — Modèle de données & auth (5–7 j) — ✅ livrée

- Schéma Prisma complet + migration initiale + migration SQL de la contrainte d'exclusion
- Seed réaliste : 2 salons, 6 coiffeurs, 15 services, 40 RDV répartis
- Auth.js v5 : email + mot de passe (Argon2) et lien magique, sessions en base
- Helper `assertCan()` + tests de la matrice de permissions
- Middleware de redirection par espace

**Fait quand** : les trois types de comptes se connectent et atterrissent sur leur espace ; un client ne peut pas atteindre `/pro/*` (vérifié par test).

### Phase 2 — Moteur de disponibilité (5–7 j) — ✅ livrée

- Fonctions pures : intersection/soustraction d'intervalles, découpe en créneaux
- Gestion des fuseaux + tests de passage à l'heure d'été/d'hiver
- Résolution « n'importe quel coiffeur »
- Couche d'accès aux données (une requête par fenêtre) + cache court
- Couverture unitaire visée : **> 95 %** sur ce module

**Fait quand** : la suite de tests couvre les cas limites (créneau accolé à une pause, absence à cheval sur deux jours, service plus long que la plage d'ouverture, jour férié, DST).

### Phase 3 — Réservation client (7–9 j) — ✅ livrée

- Recherche de salons (ville / prestation), fiche salon SSR + `JSON-LD` schema.org
- Tunnel : prestations → coiffeur ou « peu importe » → créneau → récapitulatif → confirmation
- Création transactionnelle du RDV, gestion du `409` de conflit
- Espace client : RDV à venir, historique, annulation dans le délai, profil
- Formulaires accessibles (labels associés, erreurs annoncées, focus géré)

**Fait quand** : un parcours E2E Playwright réserve, reçoit la confirmation, annule.

### Phase 4 — Agenda professionnel (8–11 j) — ✅ livrée

- Grille CSS Grid : vue jour multi-coiffeurs, vue semaine par coiffeur
- Création / déplacement / redimensionnement avec revalidation serveur
- RDV hors ligne (téléphone, comptoir) avec client invité
- Statuts : confirmé, honoré, absent (no-show), annulé
- Fiche client côté salon : historique, notes internes, coiffeur habituel
- Navigation clavier complète

**Fait quand** : un gérant gère une journée complète sans passer par la base.

### Phase 5 — Configuration du salon (5–6 j) — ✅ livrée

- Services et catégories, durées, tarifs, buffers
- Horaires d'ouverture, fermetures exceptionnelles, jours fériés
- Équipe : invitation, rôles, horaires individuels, congés, affectation des prestations
- Fiche salon : description, photos (upload + WebP + dimensions explicites), coordonnées
- Paramètres de réservation (délai mini, horizon, granularité, délai d'annulation)

**Fait quand** : un salon est entièrement paramétrable sans intervention technique.

### Phase 6 — Notifications (4–6 j) — ✅ livrée

- Resend : confirmation, modification, annulation, rappel J-1 (React Email)
- Twilio : confirmation + rappel J-1, opt-in explicite, mention STOP, journal des envois
- Job planifié horaire (Vercel Cron ou pg-boss) balayant les RDV à J-1
- Idempotence par `idempotencyKey` : jamais deux fois le même rappel
- Reprise sur échec (3 tentatives, backoff) et remontée des `FAILED` au gérant

**Fait quand** : les tests d'intégration prouvent qu'un rappel n'est envoyé qu'une fois, même si le job tourne deux fois.

### Phase 7 — Back-office plateforme & statistiques (4–5 j) — ✅ livrée

- Admin : création/suspension de salons, liste des comptes, journal d'audit, indicateurs globaux
- Stats salon : taux de remplissage, chiffre d'affaires prévisionnel, no-shows, top prestations, activité par coiffeur
- Export CSV
- Pagination systématique (aucune liste non paginée au-delà de 50 lignes)

### Phase 8 — Conformité, durcissement, mise en production (5–7 j)

- RGPD : politique de confidentialité, registre des consentements, export et effacement (anonymisation) des données, durées de conservation, DPA Resend et Twilio
- Sécurité : rate limiting sur auth et réservation, en-têtes CSP/HSTS, `npm audit`, revue `security-auditor`, aucune PII dans les logs
- Accessibilité : audit axe + parcours clavier et lecteur d'écran sur les 3 parcours clés
- Performance : Lighthouse ≥ 90 sur la fiche salon, index SQL vérifiés sur les requêtes d'agenda
- Sauvegardes Postgres + procédure de restauration testée, Sentry, README, CHANGELOG 1.0.0

**Total estimé : 46 à 62 jours-homme**, soit environ 9 à 12 semaines à temps plein. Les phases 2 et 4 concentrent le risque.

---

## 8. Stratégie de tests

| Niveau        | Outil                                                           | Cible                                                                              |
| ------------- | --------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Unitaire      | Vitest                                                          | ≥ 80 % global, > 95 % sur `features/availability`                                  |
| Intégration   | Vitest + Postgres jetable (Testcontainers ou base dédiée en CI) | RBAC, création concurrente de RDV, idempotence des notifications, transactions     |
| E2E           | Playwright                                                      | réserver / annuler côté client, journée type côté gérant, invitation d'un coiffeur |
| Accessibilité | `@axe-core/playwright`                                          | 0 violation bloquante sur les 3 parcours clés                                      |

Conventions du CLAUDE.md : pattern AAA, nommage `should <comportement> when <condition>`, aucune dépendance à l'horloge réelle (`vi.setSystemTime` partout où le temps intervient), providers externes toujours mockés.

---

## 9. Risques identifiés

| Risque                                            | Impact                                           | Parade                                                                                           |
| ------------------------------------------------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------ |
| Double réservation sur créneau concurrent         | Critique — deux clients au même horaire          | Contrainte d'exclusion Postgres + test de concurrence, jamais la seule validation applicative    |
| Heure d'été/hiver mal gérée                       | Élevé — RDV décalés d'une heure deux fois par an | Minutes locales en base, conversion au calcul, tests DST dédiés                                  |
| Dérive Prisma / SQL manuel effaçant la contrainte | Élevé — la garantie disparaît silencieusement    | `prisma migrate diff` en CI + test d'intégration qui échoue si la contrainte manque              |
| Licence FullCalendar Premium                      | Moyen — coût récurrent ou refonte                | Grille maison décidée dès la phase 4                                                             |
| Coût SMS non maîtrisé                             | Moyen                                            | Plafond mensuel par salon, SMS réservé au rappel J-1, bascule email au-delà                      |
| No-shows (pas de paiement en V1)                  | Moyen — perte de revenu salon                    | Rappel J-1, compteur de no-shows par client, empreinte CB en V2                                  |
| Fuite inter-tenant (salon A voyant salon B)       | Critique — RGPD                                  | `salonId` dans **chaque** clause `where`, helper d'accès unique, tests d'intégration d'isolation |
| Perf du calcul de créneaux à la montée en charge  | Moyen                                            | Fenêtre bornée à 7 j, requête unique, cache court, index `(memberId, startAt)`                   |

---

## 10. Hors périmètre V1 (backlog V2)

Paiement et acompte Stripe (Connect si commissions), fidélité et bons cadeaux, caisse et encaissement, gestion de stock produits, application mobile, synchronisation Google Calendar, réservation de groupe, liste d'attente sur créneau complet, avis clients, campagnes marketing, multi-langue.

---

## 11. Prochaines étapes immédiates

1. Validation de ce plan.
2. Validation des cinq ADR rédigés dans `docs/adr/` :

| ADR                                                   | Décision                                                  | À surveiller                                           |
| ----------------------------------------------------- | --------------------------------------------------------- | ------------------------------------------------------ |
| [0001](adr/0001-choix-stack-technique.md)             | Next.js fullstack + Prisma + PostgreSQL                   | Couplage au framework, Prisma limité en SQL avancé     |
| [0002](adr/0002-strategie-multi-tenancy.md)           | Isolation par colonne `salonId` + client Prisma scopé     | L'isolation dépend du code ; RLS reportée, à réévaluer |
| [0003](adr/0003-modele-de-disponibilite.md)           | Créneaux calculés à la volée, horaires en minutes locales | Coût CPU en charge                                     |
| [0004](adr/0004-integrite-anti-double-reservation.md) | Contrainte d'exclusion PostgreSQL                         | Migration SQL manuelle + garde-fous CI                 |
| [0005](adr/0005-composant-calendrier.md)              | Grille d'agenda développée en interne                     | Seuil d'abandon fixé à 8 j → bascule FullCalendar      |

3. Lancement de la phase 0.

Les ADR sont **proposés**, pas validés unilatéralement, conformément au CLAUDE.md.
