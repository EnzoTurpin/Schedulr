/**
 * Données de référence du seed.
 *
 * Séparées de la logique d'insertion pour garder chaque fichier sous la limite
 * de taille du CLAUDE.md, et pour qu'ajouter une prestation ne demande pas de
 * relire le code d'insertion.
 *
 * Les prix sont en centimes.
 */

export type ServiceSeed = {
  name: string
  durationMin: number
  priceCents: number
  bufferAfterMin?: number
}

export type CategorySeed = {
  name: string
  services: ServiceSeed[]
}

/** Catalogue du salon 1 — offre généraliste. */
export const ATELIER_CATALOG: CategorySeed[] = [
  {
    name: 'Coupe',
    services: [
      { name: 'Coupe femme', durationMin: 45, priceCents: 3500 },
      { name: 'Coupe homme', durationMin: 30, priceCents: 2400 },
      { name: 'Coupe enfant', durationMin: 30, priceCents: 1800 },
      { name: 'Frange', durationMin: 15, priceCents: 800 },
    ],
  },
  {
    name: 'Couleur',
    services: [
      // Marge de remise en état du poste après une couleur.
      { name: 'Couleur racines', durationMin: 90, priceCents: 6500, bufferAfterMin: 15 },
      { name: 'Balayage', durationMin: 90, priceCents: 9500, bufferAfterMin: 15 },
      { name: 'Patine', durationMin: 45, priceCents: 4000, bufferAfterMin: 10 },
    ],
  },
  {
    name: 'Coiffage',
    services: [
      { name: 'Brushing', durationMin: 30, priceCents: 2500 },
      { name: 'Chignon', durationMin: 60, priceCents: 5500 },
    ],
  },
]

/** Catalogue du salon 2 — positionnement soin et barbier. */
export const EMERAUDE_CATALOG: CategorySeed[] = [
  {
    name: 'Coupe',
    services: [
      { name: 'Coupe signature', durationMin: 60, priceCents: 4500 },
      { name: 'Coupe rapide', durationMin: 30, priceCents: 2600 },
    ],
  },
  {
    name: 'Barbier',
    services: [
      { name: 'Taille de barbe', durationMin: 30, priceCents: 2200 },
      {
        name: 'Rasage traditionnel',
        durationMin: 45,
        priceCents: 3200,
        bufferAfterMin: 10,
      },
    ],
  },
  {
    name: 'Soin',
    services: [
      { name: 'Soin profond', durationMin: 45, priceCents: 3800 },
      { name: 'Massage du cuir chevelu', durationMin: 30, priceCents: 2800 },
    ],
  },
]

/**
 * Horaires d'ouverture, en minutes locales depuis minuit.
 * Convention `dayOfWeek` : 0 = dimanche.
 */
export const ATELIER_OPENING = [
  // Mardi au vendredi, avec coupure déjeuner.
  { dayOfWeek: 2, startMin: 9 * 60, endMin: 12 * 60 },
  { dayOfWeek: 2, startMin: 14 * 60, endMin: 19 * 60 },
  { dayOfWeek: 3, startMin: 9 * 60, endMin: 12 * 60 },
  { dayOfWeek: 3, startMin: 14 * 60, endMin: 19 * 60 },
  { dayOfWeek: 4, startMin: 9 * 60, endMin: 12 * 60 },
  { dayOfWeek: 4, startMin: 14 * 60, endMin: 19 * 60 },
  { dayOfWeek: 5, startMin: 9 * 60, endMin: 12 * 60 },
  { dayOfWeek: 5, startMin: 14 * 60, endMin: 20 * 60 },
  // Samedi en journée continue.
  { dayOfWeek: 6, startMin: 9 * 60, endMin: 18 * 60 },
]

export const EMERAUDE_OPENING = [
  { dayOfWeek: 1, startMin: 10 * 60, endMin: 19 * 60 },
  { dayOfWeek: 2, startMin: 10 * 60, endMin: 19 * 60 },
  { dayOfWeek: 3, startMin: 10 * 60, endMin: 19 * 60 },
  { dayOfWeek: 4, startMin: 10 * 60, endMin: 21 * 60 },
  { dayOfWeek: 5, startMin: 10 * 60, endMin: 21 * 60 },
  { dayOfWeek: 6, startMin: 9 * 60, endMin: 17 * 60 },
]
