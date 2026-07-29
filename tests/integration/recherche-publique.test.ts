import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { searchSalons } from '@/features/salon/queries'
import { resetDatabase, testDb } from './helpers/db'

/**
 * Recherche publique de salons.
 *
 * Elle ne portait que sur le nom et la ville, alors qu'on cherche autant « un
 * balayage » qu'un salon par son nom.
 */

async function seed() {
  const lyon = await testDb.salon.create({
    data: {
      slug: 'atelier-lyon',
      name: 'Atelier Coiffure',
      address: '1 rue Test',
      city: 'Lyon',
      postalCode: '69000',
      isActive: true,
      services: {
        create: [
          { name: 'Balayage', durationMin: 120, priceCents: 9000, isActive: true },
          { name: 'Coupe homme', durationMin: 30, priceCents: 2500, isActive: true },
        ],
      },
    },
  })

  const nantes = await testDb.salon.create({
    data: {
      slug: 'studio-nantes',
      name: 'Studio Émeraude',
      address: '2 rue Test',
      city: 'Nantes',
      postalCode: '44000',
      isActive: true,
      services: {
        create: [
          { name: 'Coupe homme', durationMin: 30, priceCents: 2000, isActive: true },
          // Retirée du catalogue : elle ne doit plus faire remonter le salon.
          { name: 'Permanente', durationMin: 90, priceCents: 7000, isActive: false },
        ],
      },
    },
  })

  return { lyon, nantes }
}

describe('recherche publique', () => {
  beforeEach(async () => {
    await resetDatabase()
    await seed()
  })

  afterAll(async () => {
    await testDb.$disconnect()
  })

  it('should find a salon by its city', async () => {
    const { items } = await searchSalons({ q: 'lyon' })

    expect(items.map((s) => s.slug)).toEqual(['atelier-lyon'])
  })

  it('should find a salon by its name regardless of case', async () => {
    const { items } = await searchSalons({ q: 'ÉMERAUDE' })

    expect(items.map((s) => s.slug)).toEqual(['studio-nantes'])
  })

  it('should find a salon by the service it offers', async () => {
    const { items } = await searchSalons({ q: 'balayage' })

    expect(items.map((s) => s.slug)).toEqual(['atelier-lyon'])
  })

  it('should return every salon offering the service when several do', async () => {
    const { items } = await searchSalons({ q: 'coupe homme' })

    expect(items.map((s) => s.slug).sort()).toEqual(['atelier-lyon', 'studio-nantes'])
  })

  it('should ignore a deactivated service', async () => {
    // Le proposer mènerait à un tunnel incapable d'offrir cette prestation.
    const { items } = await searchSalons({ q: 'permanente' })

    expect(items).toEqual([])
  })

  it('should list every salon when the query is empty', async () => {
    const { items, total } = await searchSalons({})

    expect(total).toBe(2)
    expect(items).toHaveLength(2)
  })

  it('should exclude an inactive salon whatever the query', async () => {
    await testDb.salon.update({
      where: { slug: 'atelier-lyon' },
      data: { isActive: false },
    })

    expect((await searchSalons({ q: 'balayage' })).items).toEqual([])
  })
})
