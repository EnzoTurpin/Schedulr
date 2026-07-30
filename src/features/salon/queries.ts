import { crossSalon } from '@/lib/db/scoped'

/**
 * Lectures publiques des salons.
 *
 * Délibérément inter-salons : c'est la recherche du site public. Seuls les
 * salons actifs sont exposés, et jamais un champ interne.
 */

const PAGE_SIZE = 20

export type SalonSearchParams = {
  /** Ville, nom de salon ou prestation. */
  q?: string
  page?: number
}

/**
 * Recherche de salons.
 *
 * Insensible à la casse, sur le nom, la ville et les prestations proposées :
 * on cherche autant « un balayage près de chez moi » qu'un salon par son nom.
 * Seules les prestations actives comptent — proposer un salon pour une
 * prestation qu'il ne fait plus mènerait à un tunnel sans issue.
 *
 * Une vraie recherche plein texte (index GIN, `unaccent`) sera nécessaire à
 * l'échelle ; à ce stade elle serait prématurée.
 */
export async function searchSalons({ q, page = 1 }: SalonSearchParams) {
  const db = crossSalon('recherche publique de salons')

  const where = {
    isActive: true,
    ...(q
      ? {
          OR: [
            { name: { contains: q, mode: 'insensitive' as const } },
            { city: { contains: q, mode: 'insensitive' as const } },
            {
              services: {
                some: {
                  isActive: true,
                  name: { contains: q, mode: 'insensitive' as const },
                },
              },
            },
          ],
        }
      : {}),
  }

  const [items, total] = await Promise.all([
    db.salon.findMany({
      where,
      orderBy: [{ city: 'asc' }, { name: 'asc' }],
      take: PAGE_SIZE,
      skip: (page - 1) * PAGE_SIZE,
      select: {
        id: true,
        slug: true,
        name: true,
        city: true,
        postalCode: true,
        address: true,
        description: true,
        _count: { select: { members: { where: { isActive: true, isBookable: true } } } },
      },
    }),
    db.salon.count({ where }),
  ])

  return {
    items,
    total,
    page,
    pageCount: Math.max(1, Math.ceil(total / PAGE_SIZE)),
  }
}

/**
 * Fiche publique d'un salon, avec son catalogue et son équipe réservable.
 *
 * Retourne `null` si le salon est inconnu ou désactivé — la page appelante
 * répond alors 404, sans distinguer les deux cas.
 */
export async function getPublicSalon(slug: string) {
  const db = crossSalon('fiche publique d’un salon')

  return db.salon.findFirst({
    where: { slug, isActive: true },
    select: {
      id: true,
      slug: true,
      name: true,
      description: true,
      address: true,
      city: true,
      postalCode: true,
      country: true,
      phone: true,
      timezone: true,
      latitude: true,
      longitude: true,
      openingHours: {
        orderBy: [{ dayOfWeek: 'asc' }, { startMin: 'asc' }],
        select: { dayOfWeek: true, startMin: true, endMin: true },
      },
      /**
       * Prestations actives, à plat.
       *
       * ⚠️ Ne PAS les lire uniquement via `serviceCategories` : `categoryId`
       * est nullable, et une prestation sans catégorie serait alors invisible
       * du public — ni sur cette fiche, ni dans le tunnel de réservation.
       */
      services: {
        where: { isActive: true },
        orderBy: { name: 'asc' },
        select: {
          id: true,
          name: true,
          description: true,
          durationMin: true,
          priceCents: true,
          categoryId: true,
        },
      },
      serviceCategories: {
        orderBy: { position: 'asc' },
        select: {
          id: true,
          name: true,
          services: {
            where: { isActive: true },
            orderBy: { name: 'asc' },
            select: {
              id: true,
              name: true,
              description: true,
              durationMin: true,
              priceCents: true,
            },
          },
        },
      },
      members: {
        where: { isActive: true, isBookable: true },
        orderBy: { displayName: 'asc' },
        select: {
          id: true,
          displayName: true,
          bio: true,
          services: { select: { serviceId: true } },
        },
      },
    },
  })
}

export type PublicSalon = NonNullable<Awaited<ReturnType<typeof getPublicSalon>>>
