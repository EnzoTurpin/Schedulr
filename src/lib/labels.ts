import type { SalonRole } from '@/generated/prisma'

/**
 * Libellés francophones des rôles au sein d'un salon.
 *
 * Regroupés ici parce qu'ils étaient déjà redéfinis dans trois écrans, avec des
 * casses divergentes. Pour un usage au fil d'une phrase, appliquer
 * `toLowerCase()` sur la valeur plutôt que d'introduire une seconde table.
 */
export const SALON_ROLE_LABELS: Record<SalonRole, string> = {
  OWNER: 'Gérant',
  MANAGER: 'Manager',
  STAFF: 'Coiffeur',
}
