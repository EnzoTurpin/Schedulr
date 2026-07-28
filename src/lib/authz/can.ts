import type { SalonRole } from '@/generated/prisma'
import {
  ForbiddenError,
  ResourceNotFoundError,
  type Action,
  type Actor,
  type Membership,
  type Resource,
} from './types'

/**
 * Point unique de décision d'autorisation.
 *
 * Règle non négociable du plan d'action : le middleware Next.js ne fait que
 * rediriger. Chaque route handler et chaque server action rappelle `assertCan`.
 * Aucune décision d'accès ne s'appuie sur une valeur envoyée par le client.
 */

/** Actions ouvertes à tout compte, pour ses propres données. */
const SELF_SERVICE_ACTIONS = new Set<Action>([
  'appointment:book',
  'appointment:cancel_own',
  'appointment:read_own',
])

/** Actions réservées à l'administrateur plateforme. */
const PLATFORM_ONLY_ACTIONS = new Set<Action>([
  'salon:create',
  'salon:suspend',
  'audit:read_platform',
])

/**
 * Actions autorisées par rôle dans un salon.
 *
 * `OWNER` hérite de `MANAGER`, qui hérite de `STAFF` : la hiérarchie est
 * appliquée par `salonActionsFor`, pour éviter de répéter les listes.
 */
const STAFF_ACTIONS = new Set<Action>([
  'agenda:read_own',
  // Lecture seule de l'agenda global : un coiffeur voit le planning du salon
  // pour se coordonner, sans pouvoir le modifier.
  'agenda:read_salon',
  'timeoff:manage_own',
  // Un coiffeur gère les statuts de ses propres rendez-vous : marquer une
  // prestation réalisée ou un client absent.
  'appointment:set_status',
])

const MANAGER_ACTIONS = new Set<Action>([
  'appointment:write_any',
  'service:manage',
  'schedule:manage_salon',
  'timeoff:manage_any',
  'salon:update',
  'stats:read',
])

const OWNER_ACTIONS = new Set<Action>(['member:manage', 'audit:read_salon'])

function salonActionsFor(role: SalonRole): ReadonlySet<Action> {
  switch (role) {
    case 'STAFF':
      return STAFF_ACTIONS
    case 'MANAGER':
      return new Set([...STAFF_ACTIONS, ...MANAGER_ACTIONS])
    case 'OWNER':
      return new Set([...STAFF_ACTIONS, ...MANAGER_ACTIONS, ...OWNER_ACTIONS])
  }
}

function activeMembership(actor: Actor, salonId: string): Membership | undefined {
  return actor.memberships.find((m) => m.salonId === salonId && m.isActive)
}

/**
 * Prédicat pur : l'appelant peut-il réaliser cette action sur cette ressource ?
 *
 * Ne lève jamais. C'est ce qui permet de l'utiliser côté rendu pour afficher ou
 * masquer une commande. La distinction entre « introuvable » et « interdit »
 * appartient à `assertCan`, au moment de construire la réponse HTTP.
 */
export function can(actor: Actor, action: Action, resource: Resource): boolean {
  const isPlatformAdmin = actor.role === 'PLATFORM_ADMIN'

  if (PLATFORM_ONLY_ACTIONS.has(action)) {
    return isPlatformAdmin
  }

  // Actions sur ses propres données : ouvertes à tout compte authentifié.
  if (SELF_SERVICE_ACTIONS.has(action)) {
    if (action === 'appointment:book') {
      return true
    }
    // Annuler ou consulter suppose d'être le client du rendez-vous. Le
    // personnel du salon passe par `appointment:write_any`.
    if (resource.kind !== 'appointment') {
      return false
    }
    if (resource.clientId !== null && resource.clientId === actor.userId) {
      return true
    }
    // Pas propriétaire : on retombe sur les droits professionnels ci-dessous.
  }

  if (resource.kind === 'platform') {
    return isPlatformAdmin
  }

  // L'administrateur plateforme voit tout salon : c'est lui qui les active et
  // qui traite les litiges.
  if (isPlatformAdmin) {
    return true
  }

  const membership = activeMembership(actor, resource.salonId)
  if (!membership) {
    return false
  }

  const allowed = salonActionsFor(membership.role)
  if (!allowed.has(action)) {
    return false
  }

  // Un coiffeur ne pilote que ses propres rendez-vous ; un manager pilote ceux
  // de toute l'équipe.
  if (
    action === 'appointment:set_status' &&
    membership.role === 'STAFF' &&
    resource.kind === 'appointment' &&
    resource.memberId !== membership.memberId
  ) {
    return false
  }

  return true
}

/**
 * Variante impérative de `can`, à appeler dans chaque route handler et chaque
 * server action.
 *
 * Distingue deux refus, et cette distinction est le cœur de l'ADR-0002 :
 *
 *   - `ResourceNotFoundError` (→ 404) quand la ressource relève d'un salon
 *     auquel l'appelant n'a aucun accès. Répondre « interdit » confirmerait son
 *     existence à un salon concurrent.
 *   - `ForbiddenError` (→ 403) quand l'appelant a bien accès au salon mais que
 *     son rôle ne suffit pas. Ici, révéler l'existence est sans conséquence :
 *     il travaille dans ce salon.
 *
 * @throws {ResourceNotFoundError}
 * @throws {ForbiddenError}
 */
export function assertCan(actor: Actor, action: Action, resource: Resource): void {
  if (can(actor, action, resource)) {
    return
  }

  const outsideScope =
    resource.kind !== 'platform' &&
    actor.role !== 'PLATFORM_ADMIN' &&
    activeMembership(actor, resource.salonId) === undefined

  // Les actions sur ses propres données sont exclues : un client n'appartient
  // à aucun salon, l'absence d'appartenance y est la normale et non un indice
  // d'accès hors périmètre.
  if (outsideScope && !SELF_SERVICE_ACTIONS.has(action)) {
    throw new ResourceNotFoundError()
  }

  throw new ForbiddenError(action)
}
