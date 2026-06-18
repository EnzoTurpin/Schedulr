# ADR-0004 : Intégrité anti double-réservation par contrainte d'exclusion PostgreSQL

**Date** : 2026-07-27
**Statut** : Proposé

## Contexte

Deux clients consultent la fiche du même salon et voient le même créneau libre de 14 h chez la même coiffeuse. Ils valident à quelques millisecondes d'intervalle.

Une vérification applicative classique exécute, pour chacun :

```
1. lire les rendez-vous de la coiffeuse    → aucun conflit
2. insérer le rendez-vous                  → succès
```

Les deux transactions passent l'étape 1 avant que l'autre n'atteigne l'étape 2. **Les deux réservations sont enregistrées.** Le salon découvre le problème le jour même, avec deux clients dans la salle d'attente. C'est le défaut le plus grave possible pour ce produit : il détruit la confiance du salon, qui est le client payant.

Ce n'est pas un cas théorique. Il se produit dès qu'un créneau est convoité — samedi matin, veille de fêtes — c'est-à-dire précisément quand le produit est le plus utilisé. Le niveau d'isolation par défaut de PostgreSQL (`READ COMMITTED`) ne l'empêche pas : rien n'oblige une transaction à voir une ligne que l'autre n'a pas encore validée.

L'ADR-0003 aggrave la nécessité d'une réponse : puisque les créneaux ne sont pas matérialisés en table, il n'existe aucune ligne à verrouiller. Il n'y a rien à réserver — seulement l'absence de conflit à garantir.

### Options envisagées

**(a) Vérification applicative seule.** Insuffisante, pour la raison ci-dessus. Réduit la fenêtre de course, ne la ferme pas.

**(b) Transaction en niveau `SERIALIZABLE`.** PostgreSQL détecte l'anomalie et annule l'une des deux transactions. Correct, mais : le niveau s'applique à toute la transaction, les échecs de sérialisation (`40001`) surviennent aussi sur des opérations sans rapport, et il faut une logique de reprise généralisée. Coût de performance non ciblé.

**(c) Verrou consultatif par coiffeur** — `pg_advisory_xact_lock(hashtext(memberId))`. Sérialise les réservations d'un même coiffeur. Fonctionne, mais la garantie n'existe que si **tout** chemin d'écriture pense à prendre le verrou. Un import, un script de maintenance ou une future fonctionnalité qui l'oublie réintroduit le défaut sans aucun signal.

**(d) Contrainte d'exclusion PostgreSQL sur intervalle temporel.** La base refuse elle-même deux rendez-vous actifs qui se chevauchent pour un même coiffeur. La garantie ne dépend d'aucun chemin de code.

## Décision

Nous retenons l'option **(d)** — la garantie est portée par le schéma — complétée par **(a)** pour l'ergonomie.

```sql
CREATE EXTENSION IF NOT EXISTS btree_gist;   -- requis pour indexer "memberId" (text) avec =

ALTER TABLE "Appointment"
  ADD COLUMN period tstzrange
  GENERATED ALWAYS AS (tstzrange("startAt", "endAt", '[)')) STORED;

ALTER TABLE "Appointment"
  ADD CONSTRAINT appointment_no_overlap
  EXCLUDE USING gist ("memberId" WITH =, period WITH &&)
  WHERE (status IN ('PENDING', 'CONFIRMED'));
```

Trois détails portent tout le sens de cette contrainte :

- **`'[)'`** — borne de fin exclusive. Un rendez-vous de 14 h à 15 h et un autre de 15 h à 16 h ne se chevauchent pas. Avec `'[]'`, tous les rendez-vous consécutifs seraient rejetés.
- **`WHERE (status IN ('PENDING','CONFIRMED'))`** — contrainte partielle. Un rendez-vous annulé ou marqué absent libère le créneau, ce qui est le comportement métier attendu. Corollaire à connaître : réactiver un rendez-vous annulé peut échouer si le créneau a été repris entre-temps — le cas doit être traité explicitement dans l'interface, pas ignoré.
- **`period` en colonne générée** — dérivée de `startAt`/`endAt`, elle ne peut pas diverger de ces deux champs.

**Rôle de la vérification applicative** : elle est conservée, non pour l'intégrité mais pour le message. Elle produit une erreur métier lisible dans le cas courant ; la contrainte n'intervient que dans la véritable course.

**Traitement de l'erreur** : le code PostgreSQL `23P01` (`exclusion_violation`) est intercepté dans la couche d'accès et traduit en `409 Conflict` métier. L'interface affiche « ce créneau vient d'être réservé » et recharge les créneaux du jour, sans perdre la sélection de prestations du client.

### Le point de vigilance réel

Prisma ne sait ni générer les colonnes générées ni les contraintes d'exclusion. Quatre mesures sont donc obligatoires, et cette décision n'est pas valide sans elles.

_Cette section a été révisée après mise en œuvre en phase 1 : trois de ses affirmations initiales étaient fausses et sont corrigées ci-dessous._

1. **Migration SQL écrite à la main** dans `prisma/schema/migrations/`, jamais régénérée automatiquement. (Le chemin est `prisma/schema/migrations/` et non `prisma/migrations/` : avec un schéma multi-fichiers, Prisma place les migrations à côté du dossier de schéma.)

2. **Prérequis de typage.** `startAt` et `endAt` doivent être en `TIMESTAMPTZ` (`@db.Timestamptz(3)`). Prisma mappe `DateTime` vers `timestamp` **sans fuseau** par défaut ; le cast implicite vers `timestamptz` dépend alors du fuseau de session et PostgreSQL **refuse** l'expression générée comme non immutable. La contrainte est donc impossible à poser tant que le typage n'est pas explicite — ce qu'exige de toute façon l'ADR-0003.

3. **Déclaration défensive dans le schéma**, pour empêcher Prisma de supprimer la colonne lors d'une migration ultérieure. Forme exacte, établie empiriquement :

   ```prisma
   period Unsupported("tstzrange")? @default(dbgenerated("tstzrange(\"startAt\", \"endAt\", '[)'::text)"))
   ```

   Deux pièges rencontrés, notés ici pour ne pas être refaits : `@ignore` est **refusé** sur un champ `Unsupported` (ce type est déjà exclu du client généré, l'attribut est jugé redondant) ; et sans le `@default(dbgenerated(…))` reproduisant l'expression à l'identique, `migrate diff` signale en boucle un changement de valeur par défaut.

4. **Le garde-fou réel est le test, pas la détection de dérive.**
   - `pnpm db:drift` surveille la **colonne** `period`. Il ne voit **pas** la contrainte `EXCLUDE` : Prisma ne modélise pas les contraintes d'exclusion, si bien qu'une migration qui la supprimerait passerait ce contrôle sans un mot. La première version de cet ADR le présentait à tort comme un filet suffisant.
   - Le seul contrôle qui détecte sa disparition est `tests/integration/appointment-no-overlap.test.ts`, qui lance **dix réservations concurrentes sur le même créneau et vérifie qu'exactement une réussit**. C'est lui, et non la relecture humaine, qui protège la garantie dans le temps. Il ne doit jamais être désactivé pour cause d'instabilité.

## Conséquences

**Positives**

- Le chevauchement devient **impossible par construction**, quel que soit le chemin d'écriture : interface client, agenda professionnel, script d'import, correction manuelle en base.
- Aucun verrou applicatif à ne pas oublier, aucune logique de reprise généralisée.
- Le coût est nul en lecture ; l'index GiST est aussi exploitable par les requêtes d'agenda sur plage.
- La garantie survit aux futurs développeurs et aux futures fonctionnalités — c'est la raison principale du choix face à l'option (c).

**Négatives**

- **Dépendance forte à PostgreSQL.** Les contraintes d'exclusion n'existent pas en MySQL ni en SQLite. Un changement de moteur imposerait de repenser entièrement ce point, et SQLite est exclu pour les tests d'intégration : ils exigent un vrai PostgreSQL (Testcontainers ou base dédiée en CI).
- **Migration SQL manuelle** à maintenir, avec un risque de dérive réel — d'où les deux garde-fous, qui constituent une charge permanente de CI.
- `Unsupported(...) @ignore` introduit une zone du schéma que Prisma ne comprend pas ; les développeurs doivent savoir pourquoi elle est là. Ce fichier est la référence à citer en commentaire de la migration.
- La contrainte protège **un coiffeur contre lui-même**, rien de plus. Les ressources matérielles partagées ne sont pas couvertes (voir ADR-0003, hors périmètre).
- Le message d'erreur venant de la base est technique : la traduction en erreur métier est indispensable, sans quoi l'utilisateur voit une violation de contrainte.

**Effet de bord à anticiper**

Le déplacement d'un rendez-vous par glisser-déposer dans l'agenda professionnel peut désormais échouer sur conflit. L'interface doit appliquer une mise à jour optimiste **réversible** : replacer visuellement le rendez-vous à sa position d'origine et signaler le conflit. Sans cela, le gérant croit son déplacement effectué alors qu'il a été rejeté.
