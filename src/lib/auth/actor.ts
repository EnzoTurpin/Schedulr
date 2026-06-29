import { cache } from 'react'
import type { Actor } from '@/lib/authz/types'
import { readSessionCookie, resolveSession } from './session'

/**
 * Résolution de l'appelant à partir du cookie de session.
 *
 * `cache()` mémorise le résultat pour la durée d'une requête : plusieurs
 * composants serveur peuvent appeler `currentActor()` sans multiplier les
 * lectures en base.
 *
 * C'est la **seule** source d'identité admise côté serveur. Aucun identifiant
 * de salon, de rôle ou d'utilisateur transmis par le client ne doit servir à
 * une décision d'accès.
 */
export const currentActor = cache(async (): Promise<Actor | null> => {
  const session = await resolveSession(await readSessionCookie())
  if (!session) {
    return null
  }

  return {
    userId: session.user.id,
    role: session.user.role,
    memberships: session.user.memberships.map((membership) => ({
      salonId: membership.salonId,
      memberId: membership.id,
      role: membership.role,
      isActive: membership.isActive,
    })),
  }
})

/** Variante impérative, pour les routes qui exigent un compte connecté. */
export async function requireActor(): Promise<Actor> {
  const actor = await currentActor()
  if (!actor) {
    throw new UnauthenticatedError()
  }
  return actor
}

export class UnauthenticatedError extends Error {
  constructor() {
    super('Authentification requise.')
    this.name = 'UnauthenticatedError'
  }
}

/** Salons dans lesquels l'appelant dispose d'un accès professionnel actif. */
export function professionalSalons(actor: Actor) {
  return actor.memberships.filter((membership) => membership.isActive)
}

/**
 * Espace d'atterrissage après connexion.
 *
 * L'administrateur plateforme prime, puis l'accès professionnel, puis l'espace
 * client — un gérant qui est aussi client de son propre salon doit arriver sur
 * son agenda, pas sur ses rendez-vous personnels.
 */
export function landingPath(actor: Actor): string {
  if (actor.role === 'PLATFORM_ADMIN') {
    return '/admin'
  }
  if (professionalSalons(actor).length > 0) {
    return '/pro'
  }
  return '/mon-compte'
}
