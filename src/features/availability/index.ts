import { availabilityCacheKey, invalidateSalon, readCache, writeCache } from './cache'
import { computeSlotsByStaff, computeSlotsForAnyStaff } from './engine'
import { loadAvailabilityInput, type AvailabilityQuery } from './repository'
import type { Slot, StaffSlots } from './types'

/**
 * Point d'entrée du moteur de disponibilité.
 *
 * Assemble les trois couches : chargement (Prisma), calcul (pur), cache court.
 * C'est la seule fonction que le reste de l'application doit appeler.
 */

export type AvailabilityResult = {
  /** Un créneau par instant de départ, coiffeur déjà choisi. */
  slots: Slot[]
  /** Détail par coiffeur, pour l'affichage « choisir mon coiffeur ». */
  byStaff: StaffSlots[]
}

/**
 * Créneaux réservables pour une demande donnée.
 *
 * @param options.cache Mise en cache du résultat. À laisser actif pour les
 * pages publiques, à désactiver pour les agendas professionnels, qui doivent
 * refléter l'état réel du salon.
 */
export async function getAvailability(
  query: AvailabilityQuery,
  options: { cache?: boolean } = {},
): Promise<AvailabilityResult> {
  const useCache = options.cache ?? true
  const key = availabilityCacheKey(query)

  if (useCache) {
    const cached = readCache<AvailabilityResult>(key)
    if (cached) {
      return cached
    }
  }

  const input = await loadAvailabilityInput(query)
  const result: AvailabilityResult = {
    slots: computeSlotsForAnyStaff(input),
    byStaff: computeSlotsByStaff(input),
  }

  if (useCache) {
    writeCache(key, result)
  }

  return result
}

/**
 * À appeler après toute écriture affectant les disponibilités d'un salon.
 * Voir `cache.ts` pour la liste des évènements concernés.
 */
export { invalidateSalon }

export { computeSlotsByStaff, computeSlotsForAnyStaff } from './engine'
export { loadAvailabilityInput, SalonNotBookableError } from './repository'
export type { AvailabilityQuery } from './repository'
export type {
  AvailabilityInput,
  RecurringRange,
  SalonRules,
  Slot,
  StaffAvailability,
  StaffSlots,
} from './types'
