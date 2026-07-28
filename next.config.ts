import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,

  typedRoutes: true,

  images: {
    formats: ['image/avif', 'image/webp'],
  },

  /**
   * En-têtes de sécurité.
   *
   * La politique de sécurité de contenu est volontairement stricte : aucune
   * ressource externe n'est chargée par l'application — Resend et Twilio sont
   * appelés côté serveur, jamais depuis le navigateur.
   *
   * `'unsafe-inline'` sur les styles est imposé par Next.js, qui injecte des
   * styles en ligne pour l'hydratation. Le retirer casserait le rendu.
   * `'unsafe-eval'` n'est admis qu'en développement, pour le rechargement à
   * chaud.
   */
  async headers() {
    const isDev = process.env.NODE_ENV === 'development'

    const csp = [
      "default-src 'self'",
      `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ''}`,
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob:",
      "font-src 'self' data:",
      "connect-src 'self'",
      // Aucun contenu tiers embarqué : ces trois directives ferment autant de
      // vecteurs d'injection.
      "frame-src 'none'",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'",
      'upgrade-insecure-requests',
    ].join('; ')

    return [
      {
        source: '/:path*',
        headers: [
          { key: 'Content-Security-Policy', value: csp },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=(self), payment=()',
          },
          // Deux ans, sous-domaines compris. À n'activer qu'une fois le
          // certificat en place : un HSTS posé trop tôt rend le site
          // inaccessible en HTTP sans possibilité de retour.
          ...(isDev
            ? []
            : [
                {
                  key: 'Strict-Transport-Security',
                  value: 'max-age=63072000; includeSubDomains; preload',
                },
              ]),
        ],
      },
    ]
  },
}

export default nextConfig
