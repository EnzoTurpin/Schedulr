import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { getPublicSalon, searchSalons } from '@/features/salon/queries'
import { resetDatabase, testDb } from './helpers/db'

/**
 * Lectures publiques des salons.
 *
 * L'enjeu principal est négatif : ne jamais exposer un salon désactivé, une
 * prestation retirée du catalogue ni un coiffeur non réservable. Ces règles
 * sont invisibles à l'œil nu sur la page, mais visibles ici.
 */

async function createSalon(
  slug: string,
  overrides: Partial<Parameters<typeof testDb.salon.create>[0]['data']> = {},
) {
  return testDb.salon.create({
    data: {
      slug,
      name: `Salon ${slug}`,
      address: '1 rue des Tests',
      city: 'Lyon',
      postalCode: '69000',
      isActive: true,
      ...overrides,
    },
  })
}

describe('recherche publique de salons', () => {
  beforeEach(async () => {
    await resetDatabase()
  })

  afterAll(async () => {
    await testDb.$disconnect()
  })

  it('should list active salons', async () => {
    await createSalon('salon-a')
    await createSalon('salon-b')

    const result = await searchSalons({})

    expect(result.total).toBe(2)
  })

  it('should never expose an inactive salon', async () => {
    // Un salon non validé par l'administrateur plateforme ne doit pas être
    // réservable ni même visible.
    await createSalon('actif')
    await createSalon('inactif', { isActive: false })

    const result = await searchSalons({})

    expect(result.total).toBe(1)
    expect(result.items[0]?.slug).toBe('actif')
  })

  it('should match on the city, case-insensitively', async () => {
    await createSalon('lyonnais', { city: 'Lyon' })
    await createSalon('parisien', { city: 'Paris' })

    const result = await searchSalons({ q: 'lyon' })

    expect(result.items.map((s) => s.slug)).toEqual(['lyonnais'])
  })

  it('should match on the salon name', async () => {
    await createSalon('atelier', { name: 'L’Atelier Coiffure' })
    await createSalon('studio', { name: 'Studio Émeraude' })

    const result = await searchSalons({ q: 'atelier' })

    expect(result.items.map((s) => s.slug)).toEqual(['atelier'])
  })

  it('should return nothing when no salon matches', async () => {
    await createSalon('salon-a')

    const result = await searchSalons({ q: 'introuvable' })

    expect(result.items).toEqual([])
    expect(result.total).toBe(0)
  })

  it('should count only bookable and active members', async () => {
    const salon = await createSalon('salon-a')
    await testDb.salonMember.create({
      data: { salonId: salon.id, displayName: 'Réservable' },
    })
    await testDb.salonMember.create({
      data: { salonId: salon.id, displayName: 'Non réservable', isBookable: false },
    })
    await testDb.salonMember.create({
      data: { salonId: salon.id, displayName: 'Désactivé', isActive: false },
    })

    const result = await searchSalons({})

    expect(result.items[0]?._count.members).toBe(1)
  })

  it('should paginate results', async () => {
    for (let i = 0; i < 25; i++) {
      await createSalon(`salon-${String(i).padStart(2, '0')}`)
    }

    const first = await searchSalons({ page: 1 })
    const second = await searchSalons({ page: 2 })

    expect(first.items).toHaveLength(20)
    expect(second.items).toHaveLength(5)
    expect(first.pageCount).toBe(2)
  })
})

describe('fiche publique d’un salon', () => {
  beforeEach(async () => {
    await resetDatabase()
  })

  it('should return the salon with its catalogue', async () => {
    const salon = await createSalon('atelier')
    const category = await testDb.serviceCategory.create({
      data: { salonId: salon.id, name: 'Coupe', position: 0 },
    })
    await testDb.service.create({
      data: {
        salonId: salon.id,
        categoryId: category.id,
        name: 'Coupe femme',
        durationMin: 45,
        priceCents: 3500,
      },
    })

    const result = await getPublicSalon('atelier')

    expect(result?.name).toBe('Salon atelier')
    expect(result?.serviceCategories[0]?.services[0]?.name).toBe('Coupe femme')
  })

  it('should return null for an unknown slug', async () => {
    expect(await getPublicSalon('inconnu')).toBeNull()
  })

  it('should return null for an inactive salon', async () => {
    // Indistinguable d'un salon inexistant : la page répond 404 dans les deux
    // cas.
    await createSalon('suspendu', { isActive: false })

    expect(await getPublicSalon('suspendu')).toBeNull()
  })

  it('should expose a service that has no category', async () => {
    // `categoryId` est nullable et l'écran de configuration propose « sans
    // catégorie » : lire les prestations uniquement via `serviceCategories`
    // les rendrait invisibles du public.
    const salon = await createSalon('atelier')
    await testDb.service.create({
      data: {
        salonId: salon.id,
        name: 'Sans rubrique',
        durationMin: 30,
        priceCents: 2500,
      },
    })

    const result = await getPublicSalon('atelier')

    expect(result?.services.map((s) => s.name)).toContain('Sans rubrique')
  })

  it('should hide a deactivated service from the catalogue', async () => {
    const salon = await createSalon('atelier')
    const category = await testDb.serviceCategory.create({
      data: { salonId: salon.id, name: 'Coupe', position: 0 },
    })
    await testDb.service.create({
      data: {
        salonId: salon.id,
        categoryId: category.id,
        name: 'Retirée',
        durationMin: 30,
        priceCents: 2000,
        isActive: false,
      },
    })

    const result = await getPublicSalon('atelier')

    expect(result?.serviceCategories[0]?.services).toEqual([])
    expect(result?.services).toEqual([])
  })

  it('should only expose bookable members', async () => {
    const salon = await createSalon('atelier')
    await testDb.salonMember.create({
      data: { salonId: salon.id, displayName: 'Camille' },
    })
    await testDb.salonMember.create({
      data: { salonId: salon.id, displayName: 'Gérante', isBookable: false },
    })

    const result = await getPublicSalon('atelier')

    expect(result?.members.map((m) => m.displayName)).toEqual(['Camille'])
  })

  it('should order opening hours by day then start time', async () => {
    const salon = await createSalon('atelier')
    await testDb.openingHour.createMany({
      data: [
        { salonId: salon.id, dayOfWeek: 3, startMin: 840, endMin: 1140 },
        { salonId: salon.id, dayOfWeek: 2, startMin: 540, endMin: 720 },
        { salonId: salon.id, dayOfWeek: 3, startMin: 540, endMin: 720 },
      ],
    })

    const result = await getPublicSalon('atelier')

    expect(result?.openingHours.map((h) => [h.dayOfWeek, h.startMin])).toEqual([
      [2, 540],
      [3, 540],
      [3, 840],
    ])
  })
})
