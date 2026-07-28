import type { MetadataRoute } from 'next'
import { clientEnv } from '@/lib/env.client'

/**
 * Directives d'exploration.
 *
 * Les espaces connectés et les points d'entrée techniques sont exclus : ils
 * n'ont rien à faire dans un index, et les explorer consommerait le budget
 * d'exploration au détriment des fiches salon.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: ['/mon-compte', '/pro', '/admin', '/api/', '/reserver/'],
    },
    sitemap: `${clientEnv.NEXT_PUBLIC_APP_URL}/sitemap.xml`,
  }
}
