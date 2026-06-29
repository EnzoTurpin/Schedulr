/**
 * Constantes d'authentification sans aucune dépendance Node.
 *
 * Ce fichier est importable depuis le middleware, qui s'exécute sur le runtime
 * Edge : y importer `session.ts` ferait échouer la compilation, ce module
 * tirant `node:crypto` et `next/headers`.
 */

export const SESSION_COOKIE = 'schedulr.session'

/** Durée de vie d'une session, en jours. */
export const SESSION_DURATION_DAYS = 30

/** Longueur minimale d'un mot de passe. Ici, et non dans password.ts, pour
 * rester importable depuis un composant client sans embarquer Argon2. */
export const MIN_PASSWORD_LENGTH = 12
