# ADR-0002 : Isolation multi-tenant par colonne discriminante

**Date** : 2026-07-27
**Statut** : Proposé

## Contexte

Schedulr héberge plusieurs salons indépendants sur une même application. Chaque salon est un tenant : son équipe, ses prestations, ses horaires, son agenda et — surtout — les données personnelles de ses clients.

**Une fuite entre tenants est le risque le plus grave du projet.** Un gérant qui verrait l'agenda ou le fichier client d'un salon concurrent constitue à la fois une violation RGPD et la fin de la crédibilité commerciale du produit. Ce n'est pas un bug parmi d'autres : c'est le scénario à rendre structurellement improbable.

Particularité à ne pas perdre de vue : les **clients ne sont pas cloisonnés**. Un même compte client peut réserver dans plusieurs salons. Le tenant cloisonne les données professionnelles (agenda, notes internes, statistiques), pas l'identité du client. Une isolation physique par salon rendrait le compte client unique impossible à modéliser proprement.

### Options envisagées

**(a) Base partagée, colonne discriminante `salonId`.** Toutes les tables métier portent `salonId`. L'isolation est assurée par le code applicatif.

**(b) Un schéma PostgreSQL par salon.** Isolation forte au niveau base. Mais : les migrations doivent être rejouées sur N schémas, Prisma gère mal le multi-schéma dynamique, les statistiques inter-salons de l'espace admin deviennent des requêtes cross-schema, et le compte client partagé n'a plus de place naturelle.

**(c) Une base par salon.** Isolation maximale, coût d'infrastructure et d'exploitation prohibitif à ce stade, provisioning à écrire, même problème de compte client.

**(d) Option (a) renforcée par Row Level Security PostgreSQL.** La base refuse elle-même toute ligne hors tenant, même si le code oublie un filtre. Défense en profondeur réelle. Friction : chaque transaction doit exécuter `SET LOCAL app.current_salon_id`, ce que Prisma ne fait pas nativement — il faut envelopper chaque transaction avec un `$executeRaw` préalable, et le pooling de connexions rend l'oubli silencieusement dangereux. Un contournement mal fait donne une fausse impression de sécurité.

## Décision

Nous retenons l'option **(a)**, avec trois garde-fous obligatoires qui font partie intégrante de la décision — l'option (a) _sans_ eux serait irresponsable.

**1. `salonId` sur toute table métier, dès la migration initiale.** Y compris là où il serait dérivable par jointure (par exemple `Appointment.salonId` alors que `memberId` suffirait à le retrouver). La redondance est assumée : elle permet de filtrer sans jointure et rend l'oubli visible en revue.

**2. Un accès aux données scopé, obligatoire.** Le client Prisma brut est interdit hors de la couche d'accès aux données. On expose à la place un client dérivé par tenant, construit avec les extensions Prisma :

```ts
// src/lib/db/scoped.ts
export function forSalon(salonId: string) {
  return prisma.$extends({
    query: {
      $allModels: {
        async $allOperations({ args, query, model }) {
          if (!TENANT_MODELS.has(model)) return query(args)
          args.where = { ...args.where, salonId } // injection systématique
          return query(args)
        },
      },
    },
  })
}
```

Les requêtes véritablement inter-tenants (statistiques plateforme, recherche publique de salons) passent par un module distinct et explicitement nommé, dont l'usage est restreint à l'espace admin et aux pages publiques.

**3. Des tests d'isolation traités comme des tests de sécurité.** Pour chaque ressource exposée, un test d'intégration vérifie qu'un membre du salon A obtient `404` — et non `403` — sur une ressource du salon B. Le `404` est délibéré : un `403` confirmerait l'existence de la ressource.

La RLS (option d) est **écartée pour la V1 mais explicitement réévaluée avant l'ouverture à des salons tiers réels.** Motif : la friction Prisma/pooling créerait plus de risque qu'elle n'en supprime tant que l'équipe est réduite et que le code d'accès est petit et auditable. Ce report est un compromis conscient, pas un oubli.

## Conséquences

**Positives**

- Migrations uniques, seed unique, outillage Prisma standard.
- Compte client transverse modélisé naturellement : un `User`, plusieurs `SalonMember` ou réservations dans plusieurs salons.
- Statistiques plateforme en une requête.
- Coût d'infrastructure constant quel que soit le nombre de salons.

**Négatives**

- **L'isolation dépend entièrement du code.** Un développeur qui contourne `forSalon()` ouvre une fuite sans qu'aucune barrière ne l'arrête. C'est le prix de cette option, et la raison des trois garde-fous.
- L'extension Prisma d'injection doit couvrir tous les cas — `findMany`, `updateMany`, `deleteMany`, agrégats, requêtes imbriquées. Les `$queryRaw` échappent au mécanisme et doivent être revus manuellement.
- Toutes les données cohabitent : une erreur de restauration de sauvegarde affecte tous les salons.
- Pas de personnalisation par salon au niveau du schéma (colonnes sur mesure impossibles).

**Suivi requis**

- L'agent `security-auditor` est invoqué sur tout ajout de modèle portant `salonId` et sur tout `$queryRaw`.
- Une revue de cet ADR est planifiée avant le premier salon client externe, pour trancher l'ajout de la RLS.
