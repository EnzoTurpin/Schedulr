# Schedulr

Plateforme de réservation en ligne pour salons de coiffure. Les clients réservent
leur rendez-vous 24 h/24 en choisissant une prestation, un coiffeur et un créneau
réellement disponible ; les salons gèrent leur agenda, leur équipe et leurs
prestations depuis un espace professionnel. La plateforme est multi-salons :
chaque salon est indépendant, avec son gérant et son équipe.

**État** : phase 0 (fondations) terminée. Les écrans utilisateur arrivent à partir
de la phase 3 — voir [docs/plan-action.md](docs/plan-action.md).

## Prérequis

| Outil      | Version |
| ---------- | ------- |
| Node.js    | ≥ 20.11 |
| pnpm       | 10.x    |
| PostgreSQL | 16+     |

PostgreSQL peut être installé localement ou lancé via Docker
(`docker compose up -d`). L'extension `btree_gist` est requise — voir
[ADR-0004](docs/adr/0004-integrite-anti-double-reservation.md).

## Installation

```bash
pnpm install

# Variables d'environnement
cp .env.example .env.local
# Renseigner DATABASE_URL et générer AUTH_SECRET :
openssl rand -base64 32

# Bases de données locales
createdb schedulr_dev && createdb schedulr_shadow && createdb schedulr_test
psql -d schedulr_dev -c 'CREATE EXTENSION IF NOT EXISTS btree_gist;'
# ... à répéter sur schedulr_shadow et schedulr_test
# (ou simplement : docker compose up -d, qui s'en charge)

pnpm db:generate
pnpm dev
```

L'application répond sur http://localhost:3000.

## Variables d'environnement

Toutes sont documentées dans [`.env.example`](.env.example) et **validées au
démarrage** par `src/lib/env.schema.ts` : une variable manquante ou malformée
arrête l'application avec un message explicite.

| Variable                | Obligatoire | Rôle                                      |
| ----------------------- | ----------- | ----------------------------------------- |
| `DATABASE_URL`          | ✅          | Connexion PostgreSQL                      |
| `SHADOW_DATABASE_URL`   | —           | Base jetable de `prisma migrate` et CI    |
| `AUTH_SECRET`           | ✅          | Signature des sessions (32 car. min.)     |
| `APP_URL`               | ✅          | URL publique, sans slash final            |
| `NEXT_PUBLIC_APP_URL`   | ✅          | Idem, exposée au navigateur               |
| `NOTIFICATIONS_ENABLED` | —           | Coupe-circuit des envois (défaut `false`) |
| `RESEND_API_KEY`        | si envois   | Courriel transactionnel                   |
| `TWILIO_*`              | si envois   | SMS                                       |

⚠️ `NOTIFICATIONS_ENABLED=true` fait partir de vrais courriels et SMS vers de
vraies personnes. À laisser à `false` en développement et en préproduction.

## Commandes

| Commande             | Effet                                   |
| -------------------- | --------------------------------------- |
| `pnpm dev`           | Serveur de développement                |
| `pnpm build`         | Build de production                     |
| `pnpm test`          | Tests unitaires et d'intégration        |
| `pnpm test:coverage` | Tests avec seuils de couverture         |
| `pnpm lint`          | ESLint                                  |
| `pnpm format`        | Prettier (écriture)                     |
| `pnpm typecheck`     | Vérification TypeScript                 |
| `pnpm db:migrate`    | Créer et appliquer une migration        |
| `pnpm db:studio`     | Explorateur de base Prisma              |
| `pnpm db:seed`       | Peupler la base de développement        |
| `pnpm db:drift`      | Détecter une dérive schéma / migrations |

## Structure

```
src/
├── app/            Routes Next.js (App Router), groupées par espace
├── components/     Composants d'interface réutilisables
├── features/       Modules métier — la logique vit ici, pas dans app/
│   ├── availability/   Moteur de créneaux (fonctions pures)
│   ├── booking/        Tunnel de réservation
│   └── calendar/       Grille d'agenda
├── hooks/          Hooks React partagés
├── lib/            Socle : env, base de données, autorisations, dates
├── services/       Intégrations externes (Resend, Twilio)
├── types/          Types transverses
└── constants/      Constantes globales

prisma/             Schéma, migrations, seed
tests/              unit/ · integration/ · e2e/
docs/               Plan d'action et décisions d'architecture (ADR)
```

Règle structurante : **la logique métier ne dépend pas du transport HTTP.** Les
server actions et route handlers authentifient, valident, puis délèguent à
`features/`. C'est ce qui rend les choix techniques réversibles.

## Décisions d'architecture

Les choix structurants sont documentés et doivent être lus avant toute
contribution significative :

| ADR                                                        | Sujet                                |
| ---------------------------------------------------------- | ------------------------------------ |
| [0001](docs/adr/0001-choix-stack-technique.md)             | Stack technique                      |
| [0002](docs/adr/0002-strategie-multi-tenancy.md)           | Isolation entre salons               |
| [0003](docs/adr/0003-modele-de-disponibilite.md)           | Calcul des disponibilités et fuseaux |
| [0004](docs/adr/0004-integrite-anti-double-reservation.md) | Intégrité anti double-réservation    |
| [0005](docs/adr/0005-composant-calendrier.md)              | Composant calendrier                 |

## Contribuer

Les conventions du projet — nommage, taille des fichiers, format des commits,
règles de branches, exigences de tests — sont réunies dans
[CLAUDE.md](CLAUDE.md). En résumé :

1. Brancher depuis `main` : `<type>/<ticket>-<description>`
2. Commits au format Conventional Commits, description en français
3. `pnpm lint && pnpm typecheck && pnpm test` verts avant d'ouvrir la PR
4. Une approbation humaine et une CI verte sont requises pour fusionner

## Licence

Propriétaire — tous droits réservés.
