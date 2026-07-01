import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { forSalon } from '@/lib/db/scoped'
import { createMember, createSalon, resetDatabase, testDb } from './helpers/db'

/**
 * Tests d'isolation entre salons.
 *
 * L'ADR-0002 les traite comme des tests de sécurité, non comme des tests
 * fonctionnels : une régression ici est une fuite de données personnelles entre
 * deux salons concurrents, pas un défaut d'ergonomie.
 */

describe('cloisonnement par salon', () => {
  beforeEach(async () => {
    await resetDatabase()
  })

  afterAll(async () => {
    await testDb.$disconnect()
  })

  it('should throw when forSalon is called without a salon id', () => {
    expect(() => forSalon('')).toThrow(/sans salonId/)
  })

  describe('lectures', () => {
    it('should only return members of the scoped salon when listing', async () => {
      // Arrange
      const salonA = await createSalon('salon-a')
      const salonB = await createSalon('salon-b')
      await createMember(salonA.id, 'Camille (A)')
      await createMember(salonB.id, 'Dominique (B)')

      // Act
      const members = await forSalon(salonA.id).salonMember.findMany()

      // Assert
      expect(members).toHaveLength(1)
      expect(members[0]?.displayName).toBe('Camille (A)')
    })

    it('should not leak a neighbour member when queried by its own id', async () => {
      const salonA = await createSalon('salon-a')
      const salonB = await createSalon('salon-b')
      const memberB = await createMember(salonB.id, 'Dominique (B)')

      const found = await forSalon(salonA.id).salonMember.findUnique({
        where: { id: memberB.id },
      })

      expect(found).toBeNull()
    })

    it('should not count neighbour records', async () => {
      const salonA = await createSalon('salon-a')
      const salonB = await createSalon('salon-b')
      await createMember(salonA.id, 'Camille (A)')
      await createMember(salonB.id, 'Dominique (B)')
      await createMember(salonB.id, 'Alex (B)')

      const count = await forSalon(salonA.id).salonMember.count()

      expect(count).toBe(1)
    })

    it('should preserve an explicit filter while adding the salon scope', async () => {
      const salonA = await createSalon('salon-a')
      await createMember(salonA.id, 'Camille (A)')
      await createMember(salonA.id, 'Alex (A)')

      const members = await forSalon(salonA.id).salonMember.findMany({
        where: { displayName: 'Alex (A)' },
      })

      expect(members).toHaveLength(1)
    })
  })

  describe('écritures', () => {
    it('should stamp the scoped salon id on creation without it being passed', async () => {
      const salonA = await createSalon('salon-a')

      const created = await forSalon(salonA.id).serviceCategory.create({
        data: { name: 'Coupe' } as never,
      })

      expect(created.salonId).toBe(salonA.id)
    })

    it('should refuse to update a neighbour record', async () => {
      const salonA = await createSalon('salon-a')
      const salonB = await createSalon('salon-b')
      const memberB = await createMember(salonB.id, 'Dominique (B)')

      await expect(
        forSalon(salonA.id).salonMember.update({
          where: { id: memberB.id },
          data: { bio: 'modifié par le salon A' },
        }),
      ).rejects.toThrow()

      const untouched = await testDb.salonMember.findUniqueOrThrow({
        where: { id: memberB.id },
      })
      expect(untouched.bio).toBeNull()
    })

    it('should not delete a neighbour record through deleteMany', async () => {
      const salonA = await createSalon('salon-a')
      const salonB = await createSalon('salon-b')
      await createMember(salonB.id, 'Dominique (B)')

      const result = await forSalon(salonA.id).salonMember.deleteMany({})

      expect(result.count).toBe(0)
      expect(await testDb.salonMember.count()).toBe(1)
    })

    it('should stamp the scoped salon id on every row of a createMany', async () => {
      const salonA = await createSalon('salon-a')

      await forSalon(salonA.id).serviceCategory.createMany({
        data: [{ name: 'Coupe' }, { name: 'Couleur' }] as never,
      })

      const categories = await testDb.serviceCategory.findMany()
      expect(categories).toHaveLength(2)
      expect(categories.every((c) => c.salonId === salonA.id)).toBe(true)
    })
  })

  describe('modèles hors cloisonnement', () => {
    it('should not scope the User model, since a client belongs to no salon', async () => {
      const salonA = await createSalon('salon-a')
      await testDb.user.create({
        data: { email: 'client@example.fr', firstName: 'Client' },
      })

      const users = await forSalon(salonA.id).user.findMany()

      expect(users).toHaveLength(1)
    })
  })
})
