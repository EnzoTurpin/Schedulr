/**
 * Constantes de configuration, sans dépendance serveur.
 *
 * Isolées ici pour rester importables depuis un composant client : `settings.ts`
 * tire Prisma, et l'y référencer embarquerait la couche base dans le lot
 * JavaScript envoyé au navigateur.
 */

/** Pas de créneau admis. Une valeur libre produirait des horaires illisibles. */
export const ALLOWED_SLOT_STEPS = [5, 10, 15, 20, 30, 60] as const
