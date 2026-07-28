-- Exécuté une seule fois, à la création du volume PostgreSQL.
--
-- Crée les bases annexes attendues par le projet :
--   schedulr_shadow : base jetable de `prisma migrate` et du contrôle de dérive
--   schedulr_test   : base des tests d'intégration
--
-- L'extension btree_gist est requise par la contrainte d'exclusion
-- anti double-réservation (ADR-0004) : elle permet d'indexer une colonne
-- texte avec l'opérateur d'égalité aux côtés d'un intervalle temporel.

CREATE DATABASE schedulr_shadow;
CREATE DATABASE schedulr_test;

\connect schedulr_dev
CREATE EXTENSION IF NOT EXISTS btree_gist;

\connect schedulr_shadow
CREATE EXTENSION IF NOT EXISTS btree_gist;

\connect schedulr_test
CREATE EXTENSION IF NOT EXISTS btree_gist;
