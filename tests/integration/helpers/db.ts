import { PrismaClient } from '@/generated/prisma'

const DATABASE_URL = process.env.DATABASE_URL ?? ''

/**
 * Garde-fou : refuser toute base qui ne soit pas une base de test.
 *
 * `resetDatabase()` efface l'intégralité des données. Or un développeur qui
 * charge son `.env` avant de lancer les tests ferait pointer cette URL sur sa
 * base de développement, et la perdrait sans un mot d'avertissement. La
 * convention est donc explicite : le nom de la base doit contenir « test ».
 */
if (!/test/i.test(DATABASE_URL)) {
  throw new Error(
    `Les tests d'intégration refusent de s'exécuter sur « ${DATABASE_URL} » : ` +
      `le nom de la base doit contenir « test ». Ces tests effacent toutes les ` +
      `données — pointer une base de développement la détruirait.`,
  )
}

/**
 * Client Prisma des tests d'intégration.
 *
 * Pointe sur `schedulr_test`, jamais sur la base de développement.
 */
export const testDb = new PrismaClient({
  datasources: { db: { url: DATABASE_URL } },
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
  // Sans clé étrangère vers Salon ni User : à vider explicitement.
  await testDb.$executeRawUnsafe('DELETE FROM "VerificationToken"')
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
