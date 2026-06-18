import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,

  typedRoutes: true,

  images: {
    formats: ['image/avif', 'image/webp'],
  },

  // En-têtes de sécurité appliqués globalement. La CSP complète est posée en
  // phase 8 (durcissement) : elle demande de recenser les domaines réellement
  // utilisés (Resend, Twilio, stockage images) sous peine de casser la prod.
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=(self)',
          },
        ],
      },
    ]
  },
}

export default nextConfig
