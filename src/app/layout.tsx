import type { Metadata, Viewport } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: {
    default: 'Schedulr — Réservation en ligne pour salons de coiffure',
    template: '%s | Schedulr',
  },
  description:
    'Réservez votre rendez-vous en ligne dans votre salon de coiffure, 24 h/24, ' +
    'et gérez votre agenda professionnel au même endroit.',
  robots: {
    // La visibilité est ouverte en phase 8, une fois les pages publiques
    // réellement prêtes à être indexées.
    index: false,
    follow: false,
  },
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
