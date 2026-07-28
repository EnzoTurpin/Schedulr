import { invalidateSalon } from '@/features/availability'
import { assertCan } from '@/lib/authz/can'
import { ResourceNotFoundError, type Actor } from '@/lib/authz/types'
import { prisma } from '@/lib/db/client'
import { crossSalon } from '@/lib/db/scoped'

/**
 * Actions de l'administrateur plateforme.
 *
 * Créer et suspendre un salon sont les deux seules opérations qui échappent au
 * cloisonnement : elles portent sur la table des tenants elle-même.
 * Chacune est journalisée.
 */

export class SlugTakenError extends Error {
  constructor() {
    super('Cette adresse de salon est déjà utilisée.')
    this.name = 'SlugTakenError'
  }
}

export type CreateSalonInput = {
  slug: string
  name: string
  address: string
  city: string
  postalCode: string
  /** Compte du gérant. Il doit exister : on ne crée pas de compte à sa place. */
  ownerEmail: string
  ownerDisplayName: string
}

/**
 * Crée un salon et son gérant.
 *
 * Le salon naît **inactif** : il n'apparaît ni dans la recherche publique ni
 * dans la réservation tant que l'administrateur ne l'a pas activé, une fois les
 * informations vérifiées.
 */
export async function createSalon(actor: Actor, input: CreateSalonInput) {
  assertCan(actor, 'salon:create', { kind: 'platform' })

  const db = crossSalon('création d’un salon')

  const [existing, owner] = await Promise.all([
    db.salon.findUnique({ where: { slug: input.slug }, select: { id: true } }),
    prisma.user.findUnique({
      where: { email: input.ownerEmail.toLowerCase().trim() },
      select: { id: true, deletedAt: true },
    }),
  ])

  if (existing) throw new SlugTakenError()
  if (!owner || owner.deletedAt !== null) {
    throw new ResourceNotFoundError()
  }

  const salon = await db.salon.create({
    data: {
      slug: input.slug,
      name: input.name,
      address: input.address,
      city: input.city,
      postalCode: input.postalCode,
      isActive: false,
      members: {
        create: {
          userId: owner.id,
          role: 'OWNER',
          displayName: input.ownerDisplayName,
          // Le gérant n'est pas réservable par défaut : c'est à lui d'en
          // décider dans sa configuration.
          isBookable: false,
        },
      },
    },
    select: { id: true, slug: true, name: true },
  })

  await prisma.auditLog.create({
    data: {
      salonId: salon.id,
      actorId: actor.userId,
      action: 'salon.created',
      targetType: 'Salon',
      targetId: salon.id,
      // Aucune donnée personnelle : le slug est public.
      metadata: { slug: salon.slug },
    },
  })

  return salon
}

/**
 * Active ou suspend un salon.
 *
 * Une suspension retire immédiatement le salon de la recherche et de la
 * réservation. Les rendez-vous déjà pris ne sont pas annulés — ce serait une
 * décision commerciale, pas technique — mais plus aucune notification ne part
 * (voir `reminders.ts`).
 */
export async function setSalonActive(
  actor: Actor,
  salonId: string,
  isActive: boolean,
  reason?: string,
) {
  assertCan(actor, 'salon:suspend', { kind: 'salon', salonId })

  const db = crossSalon('activation d’un salon')

  const existing = await db.salon.findUnique({
    where: { id: salonId },
    select: { id: true, isActive: true },
  })
  if (!existing) throw new ResourceNotFoundError()

  const salon = await db.salon.update({
    where: { id: salonId },
    data: { isActive },
    select: { id: true, name: true, isActive: true },
  })

  await prisma.auditLog.create({
    data: {
      salonId,
      actorId: actor.userId,
      action: isActive ? 'salon.activated' : 'salon.suspended',
      targetType: 'Salon',
      targetId: salonId,
      metadata: { from: existing.isActive, to: isActive, reason: reason ?? null },
    },
  })

  // La fiche publique et les créneaux sont servis depuis le cache.
  invalidateSalon(salonId)
  return salon
}
