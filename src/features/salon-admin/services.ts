import { invalidateSalon } from '@/features/availability'
import { assertCan } from '@/lib/authz/can'
import { ResourceNotFoundError, type Actor } from '@/lib/authz/types'
import { forSalon } from '@/lib/db/scoped'

/**
 * Catalogue du salon : catégories et prestations.
 *
 * Toute écriture invalide le cache de disponibilité : changer une durée déplace
 * les créneaux proposés, et un cache non vidé continuerait d'afficher les
 * anciens (ADR-0003).
 *
 * Une prestation n'est jamais supprimée physiquement tant qu'elle est
 * référencée par un rendez-vous : les lignes `AppointmentItem` portent une clé
 * étrangère en `Restrict`, et l'historique d'un salon doit rester lisible.
 */

export type ServiceInput = {
  name: string
  description?: string | null
  categoryId?: string | null
  durationMin: number
  bufferBeforeMin: number
  bufferAfterMin: number
  priceCents: number
}

/** Catalogue complet, catégories comprises, pour l'écran de configuration. */
export async function listCatalog(actor: Actor, salonId: string) {
  assertCan(actor, 'service:manage', { kind: 'salon', salonId })
  const db = forSalon(salonId)

  const [categories, services] = await Promise.all([
    db.serviceCategory.findMany({
      orderBy: { position: 'asc' },
      select: { id: true, name: true, position: true },
    }),
    db.service.findMany({
      orderBy: [{ name: 'asc' }],
      select: {
        id: true,
        name: true,
        description: true,
        categoryId: true,
        durationMin: true,
        bufferBeforeMin: true,
        bufferAfterMin: true,
        priceCents: true,
        isActive: true,
        _count: { select: { staff: true } },
      },
    }),
  ])

  return { categories, services }
}

export async function createCategory(actor: Actor, salonId: string, name: string) {
  assertCan(actor, 'service:manage', { kind: 'salon', salonId })
  const db = forSalon(salonId)

  const last = await db.serviceCategory.findFirst({
    orderBy: { position: 'desc' },
    select: { position: true },
  })

  const category = await db.serviceCategory.create({
    data: { salonId, name, position: (last?.position ?? -1) + 1 },
    select: { id: true, name: true, position: true },
  })

  invalidateSalon(salonId)
  return category
}

export async function renameCategory(
  actor: Actor,
  salonId: string,
  categoryId: string,
  name: string,
) {
  assertCan(actor, 'service:manage', { kind: 'salon', salonId })
  const db = forSalon(salonId)

  const existing = await db.serviceCategory.findUnique({
    where: { id: categoryId },
    select: { id: true },
  })
  if (!existing) throw new ResourceNotFoundError()

  return db.serviceCategory.update({
    where: { id: categoryId },
    data: { name },
    select: { id: true, name: true },
  })
}

/**
 * Supprime une catégorie. Les prestations qu'elle contenait sont conservées et
 * simplement détachées — supprimer une rubrique ne doit pas faire disparaître
 * la moitié du catalogue.
 */
export async function deleteCategory(actor: Actor, salonId: string, categoryId: string) {
  assertCan(actor, 'service:manage', { kind: 'salon', salonId })
  const db = forSalon(salonId)

  const existing = await db.serviceCategory.findUnique({
    where: { id: categoryId },
    select: { id: true },
  })
  if (!existing) throw new ResourceNotFoundError()

  await db.serviceCategory.delete({ where: { id: categoryId } })
  invalidateSalon(salonId)
}

export async function createService(actor: Actor, salonId: string, input: ServiceInput) {
  assertCan(actor, 'service:manage', { kind: 'salon', salonId })
  const db = forSalon(salonId)

  // Une catégorie d'un autre salon serait acceptée par la clé étrangère si on
  // ne la vérifiait pas : le cloisonnement porte sur `Service`, pas sur la
  // valeur de `categoryId`.
  if (input.categoryId) {
    const category = await db.serviceCategory.findUnique({
      where: { id: input.categoryId },
      select: { id: true },
    })
    if (!category) throw new ResourceNotFoundError()
  }

  const service = await db.service.create({
    data: { salonId, ...input },
    select: { id: true, name: true },
  })

  invalidateSalon(salonId)
  return service
}

export async function updateService(
  actor: Actor,
  salonId: string,
  serviceId: string,
  input: ServiceInput,
) {
  assertCan(actor, 'service:manage', { kind: 'salon', salonId })
  const db = forSalon(salonId)

  const existing = await db.service.findUnique({
    where: { id: serviceId },
    select: { id: true },
  })
  if (!existing) throw new ResourceNotFoundError()

  if (input.categoryId) {
    const category = await db.serviceCategory.findUnique({
      where: { id: input.categoryId },
      select: { id: true },
    })
    if (!category) throw new ResourceNotFoundError()
  }

  const service = await db.service.update({
    where: { id: serviceId },
    data: input,
    select: { id: true, name: true },
  })

  // Les rendez-vous déjà pris gardent leur prix et leur durée : ils sont figés
  // dans `AppointmentItem` à la réservation.
  invalidateSalon(salonId)
  return service
}

/**
 * Active ou retire une prestation du catalogue.
 *
 * Le retrait est préféré à la suppression : une prestation désactivée
 * disparaît de la réservation en ligne sans rompre les rendez-vous passés qui
 * la référencent.
 */
export async function setServiceActive(
  actor: Actor,
  salonId: string,
  serviceId: string,
  isActive: boolean,
) {
  assertCan(actor, 'service:manage', { kind: 'salon', salonId })
  const db = forSalon(salonId)

  const existing = await db.service.findUnique({
    where: { id: serviceId },
    select: { id: true },
  })
  if (!existing) throw new ResourceNotFoundError()

  const service = await db.service.update({
    where: { id: serviceId },
    data: { isActive },
    select: { id: true, isActive: true },
  })

  invalidateSalon(salonId)
  return service
}
