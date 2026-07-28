/**
 * Traduction des erreurs PostgreSQL en erreurs métier.
 *
 * La contrainte d'exclusion de l'ADR-0004 protège l'intégrité, mais son message
 * est technique. Sans traduction, l'utilisateur verrait passer une violation de
 * contrainte au lieu d'un « ce créneau vient d'être réservé ».
 */

/**
 * SQLSTATE `exclusion_violation`.
 *
 * Prisma remonte les violations de contrainte d'exclusion en
 * `PrismaClientUnknownRequestError`, sans `code` ni `meta` structurés : il faut
 * donc reconnaître le SQLSTATE dans le message. On s'appuie sur le code et non
 * sur le nom de la contrainte, qui pourrait être renommé.
 */
const EXCLUSION_VIOLATION = '23P01'

/**
 * Le créneau demandé vient d'être pris par une réservation concurrente.
 *
 * À traduire en HTTP 409 avec rafraîchissement des créneaux côté interface,
 * sans perdre la sélection de prestations du client.
 */
export class SlotConflictError extends Error {
  constructor() {
    super('Ce créneau vient d’être réservé.')
    this.name = 'SlotConflictError'
  }
}

/** Reconnaît une collision de créneaux remontée par la base. */
export function isSlotConflict(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false
  }
  return error.message.includes(EXCLUSION_VIOLATION)
}

/**
 * Exécute une écriture de rendez-vous en traduisant une éventuelle collision.
 *
 * Toute création ou déplacement de rendez-vous doit passer par ici : c'est le
 * point unique où la garantie de la base devient un message utilisateur.
 */
export async function withSlotConflictMapping<T>(
  operation: () => Promise<T>,
): Promise<T> {
  try {
    return await operation()
  } catch (error) {
    if (isSlotConflict(error)) {
      throw new SlotConflictError()
    }
    throw error
  }
}
