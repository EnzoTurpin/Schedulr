-- Intégrité anti double-réservation — ADR-0004
--
-- Migration écrite à la main : Prisma ne sait générer ni les colonnes générées
-- ni les contraintes d'exclusion. Ne pas la supprimer, ne pas la régénérer.
--
-- Ce que garantit cette migration : deux rendez-vous actifs d'un même coiffeur
-- ne peuvent pas se chevaucher, quel que soit le chemin d'écriture — interface
-- client, agenda professionnel, script d'import ou correction manuelle en base.
-- La vérification applicative seule laisserait passer deux réservations
-- concurrentes sur le même créneau (les deux lisent « libre » avant que l'une
-- n'écrive).
--
-- Prérequis : "startAt" et "endAt" doivent être de type TIMESTAMPTZ. Avec un
-- `timestamp` sans fuseau, le cast implicite vers timestamptz dépend du fuseau
-- de session et PostgreSQL refuse l'expression générée comme non immutable.
-- C'est la raison du `@db.Timestamptz(3)` posé sur tous les champs DateTime.

-- Requis pour indexer une colonne texte avec l'opérateur d'égalité aux côtés
-- d'un intervalle dans un index GiST.
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- Emprise temporelle du rendez-vous, dérivée de startAt/endAt : étant générée,
-- elle ne peut pas diverger de ces deux colonnes.
--
-- Borne de fin EXCLUSIVE ('[)') : un rendez-vous 14 h–15 h et un rendez-vous
-- 15 h–16 h ne se chevauchent pas. Avec '[]', tous les rendez-vous consécutifs
-- seraient rejetés.
ALTER TABLE "Appointment"
  ADD COLUMN "period" tstzrange
  GENERATED ALWAYS AS (tstzrange("startAt", "endAt", '[)')) STORED;

-- Contrainte PARTIELLE : seuls les statuts actifs occupent le créneau. Annuler
-- un rendez-vous ou le marquer « absent » libère donc la plage, ce qui est le
-- comportement métier attendu.
--
-- Corollaire à connaître : réactiver un rendez-vous annulé peut désormais
-- échouer si le créneau a été repris entre-temps. Ce cas doit être traité
-- explicitement dans l'interface, pas ignoré.
ALTER TABLE "Appointment"
  ADD CONSTRAINT "Appointment_no_overlap"
  EXCLUDE USING gist ("memberId" WITH =, "period" WITH &&)
  WHERE ("status" IN ('PENDING', 'CONFIRMED'));

-- Cohérence élémentaire : une plage doit avoir une durée strictement positive.
-- Sans cela, un rendez-vous de durée nulle passerait la contrainte d'exclusion
-- sans jamais entrer en conflit avec quoi que ce soit.
ALTER TABLE "Appointment"
  ADD CONSTRAINT "Appointment_end_after_start"
  CHECK ("endAt" > "startAt");
