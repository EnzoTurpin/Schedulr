import { PrismaClient } from '@/generated/prisma'

/**
 * Client Prisma des tests d'intégration.
 *
 * Pointe sur `schedulr_test`, jamais sur la base de développement : les tests
 * effacent des données.
 */
export const testDb = new PrismaClient({
  datasources: { db: { url: process.env.DATABASE_URL } },
  log: ['warn', 'error'],
})

/**
 * Vide les tables métier entre deux tests.
 *
 * `DELETE` et non `TRUNCATE`, pour une raison précise : `TRUNCATE` exige un
 * verrou ACCESS EXCLUSIVE sur chaque table. Les fichiers de test s'exécutent en
 * série, mais leurs pools de connexions se recouvrent le temps qu'un
 * `$disconnect` prenne effet — et le `TRUNCATE` attendait alors ces connexions
 * résiduelles, jusqu'à faire expirer des tests par intermittence. `DELETE` se
 * contente d'un verrou ROW EXCLUSIVE.
 *
 * Deux instructions suffisent : toutes les tables métier sont rattachées à
 * `Salon` ou à `User` par une clé étrangère en `ON DELETE CASCADE`. À la
 * volumétrie des tests, l'écart de performance avec `TRUNCATE` est nul.
 */
export async function resetDatabase(): Promise<void> {
  await testDb.$executeRawUnsafe('DELETE FROM "Salon"')
  await testDb.$executeRawUnsafe('DELETE FROM "User"')
}

/** Crée un salon minimal et valide. */
export async function createSalon(slug: string, name = slug) {
  return testDb.salon.create({
    data: {
      slug,
      name,
      address: '1 rue des Tests',
      city: 'Lyon',
      postalCode: '69000',
      isActive: true,
    },
  })
}

/** Crée un coiffeur réservable dans un salon. */
export async function createMember(salonId: string, displayName: string) {
  return testDb.salonMember.create({
    data: { salonId, displayName, role: 'STAFF' },
  })
}
