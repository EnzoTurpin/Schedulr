import type { MetadataRoute } from 'next'
import { clientEnv } from '@/lib/env.client'
import { crossSalon } from '@/lib/db/scoped'

/**
 * Plan du site : accueil, politique de confidentialité et fiches des salons
 * actifs.
 *
 * Un salon suspendu en disparaît immédiatement — il ne doit plus être proposé
 * aux visiteurs.
 */
/**
 * Calculé à la demande, jamais au build.
 *
 * Deux raisons : la liste des salons actifs change en permanence, et un
 * sitemap figé à la compilation serait périmé dès la création du salon
 * suivant. Accessoirement, le job de build de l'intégration continue n'a pas
 * de base de données — le prérendu échouerait.
 */
export const dynamic = 'force-dynamic'

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = clientEnv.NEXT_PUBLIC_APP_URL

  const salons = await crossSalon('plan du site public').salon.findMany({
    where: { isActive: true },
    select: { slug: true, updatedAt: true },
  })

  return [
    { url: base, changeFrequency: 'daily', priority: 1 },
    { url: `${base}/confidentialite`, changeFrequency: 'yearly', priority: 0.3 },
    ...salons.map((salon) => ({
      url: `${base}/salon/${salon.slug}`,
      lastModified: salon.updatedAt,
      changeFrequency: 'weekly' as const,
      priority: 0.8,
    })),
  ]
}
