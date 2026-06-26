import type { SalonRole, UserRole } from '@/generated/prisma'

/**
 * Modèle d'autorisation (plan d'action, §2).
 *
 * Deux niveaux de rôle : un rôle global porté par le compte, un rôle par salon
 * porté par l'appartenance. Un même utilisateur peut être client du salon A et
 * coiffeur du salon B — d'où la séparation.
 */

export type Membership = {
  salonId: string
  /** Identifiant du `SalonMember`, distinct de l'identifiant du compte. */
  memberId: string
  role: SalonRole
  isActive: boolean
}

/** Identité résolue de l'appelant, telle qu'établie côté serveur. */
export type Actor = {
  userId: string
  role: UserRole
  memberships: readonly Membership[]
}

export const ACTIONS = [
  // Espace client
  'appointment:book',
  'appointment:cancel_own',
  'appointment:read_own',

  // Agenda professionnel
  'agenda:read_own',
  'agenda:read_salon',
  'appointment:write_any',
  'appointment:set_status',

  // Configuration du salon
  'service:manage',
  'schedule:manage_salon',
  'timeoff:manage_own',
  'timeoff:manage_any',
  'salon:update',
  'stats:read',

  // Équipe
  'member:manage',

  // Plateforme
  'salon:create',
  'salon:suspend',
  'audit:read_salon',
  'audit:read_platform',
] as const

export type Action = (typeof ACTIONS)[number]

/**
 * Cible du contrôle.
 *
 * `salon` couvre toute ressource rattachée à un salon ; `appointment` ajoute le
 * propriétaire du rendez-vous, nécessaire pour distinguer « son » rendez-vous
 * de celui d'un autre.
 */
export type Resource =
  | { kind: 'platform' }
  | { kind: 'salon'; salonId: string }
  | {
      kind: 'appointment'
      salonId: string
      /** Coiffeur affecté au rendez-vous. */
      memberId: string
      /** Compte client, nul pour un rendez-vous pris hors ligne. */
      clientId: string | null
    }

/**
 * Accès refusé alors que l'appelant a bien accès au salon concerné : son rôle
 * ne suffit pas.
 */
export class ForbiddenError extends Error {
  constructor(action: Action) {
    super(`Action « ${action} » non autorisée pour ce rôle.`)
    this.name = 'ForbiddenError'
  }
}

/**
 * Ressource inaccessible parce qu'elle appartient à un autre salon.
 *
 * Distincte de `ForbiddenError` à dessein (ADR-0002) : répondre « interdit »
 * confirmerait l'existence de la ressource à un salon concurrent. L'appelant
 * doit recevoir un 404, pas un 403.
 */
export class ResourceNotFoundError extends Error {
  constructor() {
    super('Ressource introuvable.')
    this.name = 'ResourceNotFoundError'
  }
}
