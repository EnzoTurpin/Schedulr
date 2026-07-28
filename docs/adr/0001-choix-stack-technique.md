# ADR-0001 : Stack technique — Next.js fullstack avec Prisma et PostgreSQL

**Date** : 2026-07-27
**Statut** : Proposé

## Contexte

Schedulr est une plateforme de réservation en ligne pour salons de coiffure, développée à partir d'un dépôt vierge. Les contraintes qui pèsent sur le choix de stack :

- **Référencement naturel obligatoire** — les fiches salon publiques sont le principal canal d'acquisition. Elles doivent être rendues côté serveur et indexables.
- **Développement par une personne** — le coût de coordination entre plusieurs déploiements, plusieurs pipelines et deux jeux de types est disproportionné.
- **Trois espaces applicatifs distincts** — public/client, professionnel, administration plateforme — mais un seul domaine métier partagé.
- **Temps réel modéré** — l'agenda doit refléter les nouvelles réservations rapidement, mais une latence de quelques secondes est acceptable. Pas de besoin de collaboration simultanée sur un même objet.
- **Budget d'infrastructure faible** en phase de démarrage.

### Options envisagées

**(a) Next.js 15 App Router + Prisma + PostgreSQL managé.** Un seul dépôt, un seul déploiement. Rendu serveur natif pour le SEO. Prisma donne des types dérivés du schéma jusque dans les composants. Écosystème très documenté, ce qui compte pour un développeur seul.

**(b) Next.js + Supabase.** Postgres, authentification, temps réel et stockage fournis. Moins de code backend à écrire, agenda temps réel presque gratuit. En contrepartie : l'isolation multi-tenant repose sur les politiques RLS, dont la mise au point est délicate et se teste mal ; forte dépendance au fournisseur ; la logique métier complexe (moteur de créneaux) finit de toute façon écrite côté serveur applicatif.

**(c) React/Vite + API NestJS séparée.** Séparation nette, API réutilisable par une future application mobile. Mais deux déploiements, deux pipelines CI, du boilerplate NestJS, et le SEO à reconstruire (SSR manuel ou prérendu). Coût structurel non justifié tant qu'il n'existe pas de second consommateur de l'API.

## Décision

Nous retenons l'option **(a)** :

| Couche           | Choix                                                |
| ---------------- | ---------------------------------------------------- |
| Framework        | Next.js 15, App Router, React Server Components      |
| Langage          | TypeScript en mode `strict`                          |
| Base de données  | PostgreSQL (Neon en préproduction, Docker en local)  |
| ORM              | Prisma                                               |
| Authentification | Auth.js v5, sessions persistées en base              |
| Interface        | Tailwind CSS + shadcn/ui                             |
| Validation       | Zod, partagée entre formulaires et frontière serveur |
| Tests            | Vitest (unitaire, intégration), Playwright (E2E)     |

Contrainte d'architecture associée : **la logique métier vit dans `src/features/`, sans dépendance au transport HTTP ni aux API Next.js.** Les server actions et route handlers ne font qu'authentifier, valider l'entrée et déléguer. Cette règle est ce qui rend la décision réversible.

## Conséquences

**Positives**

- Un seul déploiement, une seule CI, un seul jeu de types de bout en bout.
- Le rendu serveur des fiches salon est natif, sans travail supplémentaire.
- Prisma rend le schéma multi-tenant explicite et versionné dans le dépôt, ce qui est déterminant pour l'ADR-0002.
- Les données de référence (services, horaires) peuvent être chargées dans des composants serveur sans construire d'API pour elles.

**Négatives**

- **Couplage au framework** : les server actions sont une API propre à Next.js. Une application mobile ne pourra pas les consommer et exigera une couche REST ou tRPC dédiée. Atténué par l'isolation de la logique dans `features/`, mais le travail restera à faire.
- **Prisma est limité sur le SQL avancé.** Il ne génère ni colonnes générées ni contraintes d'exclusion — précisément ce dont l'ADR-0004 a besoin. Des migrations SQL manuelles seront nécessaires, avec le risque de dérive que cela implique.
- Le temps réel n'est pas fourni : le rafraîchissement de l'agenda se fera par revalidation et interrogation périodique en V1. Un besoin de collaboration réelle imposerait d'ajouter un canal SSE ou WebSocket.
- Adhérence à l'écosystème Vercel pour le déploiement le plus simple. Un hébergement Node autonome reste possible mais demande de reconstruire les tâches planifiées.

**Neutres**

- Auth.js v5 en sessions base de données plutôt qu'en JWT : révocation immédiate possible (important pour désactiver un employé qui quitte le salon), au prix d'une lecture en base par requête authentifiée.
