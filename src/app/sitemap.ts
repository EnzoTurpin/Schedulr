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
