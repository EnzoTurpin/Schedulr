import type { Metadata, Viewport } from 'next'
import { clientEnv } from '@/lib/env.client'
import './globals.css'

export const metadata: Metadata = {
  /**
   * Base des URL absolues : sans elle, `alternates.canonical` reste relatif et
   * les moteurs le rejettent.
   */
  metadataBase: new URL(clientEnv.NEXT_PUBLIC_APP_URL),
  title: {
    default: 'Schedulr — Réservation en ligne pour salons de coiffure',
    template: '%s | Schedulr',
  },
  description:
    'Réservez votre rendez-vous en ligne dans votre salon de coiffure, 24 h/24, ' +
    'et gérez votre agenda professionnel au même endroit.',
  /**
   * Les pages publiques sont indexables : le référencement des fiches salon
   * est le principal canal d'acquisition (ADR-0001).
   *
   * Les espaces privés — client, professionnel, administration — posent leur
   * propre `noindex`, et le tunnel de réservation aussi.
   */
  robots: { index: true, follow: true },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
}

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="fr">
      <body>
        <a
          href="#contenu"
          className="focus:bg-brand-600 sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded focus:px-4 focus:py-2 focus:text-white"
        >
          Aller au contenu principal
        </a>
        {children}
      </body>
    </html>
  )
}
