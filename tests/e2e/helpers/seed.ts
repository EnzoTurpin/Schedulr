import { createHash, randomBytes } from 'node:crypto'
import { PrismaClient } from '../../../src/generated/prisma'
import { hashPassword } from '../../../src/lib/auth/password'

/**
 * Jeu de données des tests de bout en bout.
 *
 * Construit un salon complet et un compte client, sur la base `schedulr_e2e`.
 * Les horaires couvrent tous les jours de la semaine pour que les tests ne
 * dépendent pas du jour où ils s'exécutent.
 */

const DATABASE_URL =
  process.env.E2E_DATABASE_URL ??
  `postgresql://${process.env.USER ?? 'postgres'}@localhost:5432/schedulr_e2e`

export const e2eDb = new PrismaClient({
  datasources: { db: { url: DATABASE_URL } },
})

export const CLIENT_EMAIL = 'client.e2e@example.fr'
export const CLIENT_PASSWORD = 'mot-de-passe-e2e-2026'
export const SALON_SLUG = 'salon-e2e'

export async function resetE2eDatabase(): Promise<void> {
  await e2eDb.$executeRawUnsafe('DELETE FROM "Salon"')
  await e2eDb.$executeRawUnsafe('DELETE FROM "User"')
}

export async function seedE2e() {
  await resetE2eDatabase()

  const salon = await e2eDb.salon.create({
    data: {
      slug: SALON_SLUG,
      name: 'Salon Bout-en-Bout',
      description: 'Salon utilisé par les tests automatisés.',
      address: '3 rue de la Recette',
      city: 'Lyon',
      postalCode: '69002',
      isActive: true,
      slotStepMin: 30,
      // Aucun délai minimum : les tests peuvent réserver dès aujourd'hui.
      bookingLeadTimeMin: 0,
      cancellationDeadlineHours: 24,
      openingHours: {
        // Sept jours sur sept : le test ne doit pas échouer un dimanche.
        create: Array.from({ length: 7 }, (_, dayOfWeek) => ({
          dayOfWeek,
          startMin: 9 * 60,
          endMin: 19 * 60,
        })),
      },
    },
  })

  const category = await e2eDb.serviceCategory.create({
    data: { salonId: salon.id, name: 'Coupe', position: 0 },
  })

  const service = await e2eDb.service.create({
    data: {
      salonId: salon.id,
      categoryId: category.id,
      name: 'Coupe femme',
      durationMin: 60,
      priceCents: 3500,
    },
  })

  const member = await e2eDb.salonMember.create({
    data: {
      salonId: salon.id,
      displayName: 'Camille',
      workingHours: {
        create: Array.from({ length: 7 }, (_, dayOfWeek) => ({
          salonId: salon.id,
          dayOfWeek,
          startMin: 9 * 60,
          endMin: 19 * 60,
        })),
      },
      services: { create: [{ salonId: salon.id, serviceId: service.id }] },
    },
  })

  const user = await e2eDb.user.create({
    data: {
      email: CLIENT_EMAIL,
      firstName: 'Camille',
      lastName: 'Testeuse',
      emailVerified: new Date(),
      passwordHash: await hashPassword(CLIENT_PASSWORD),
    },
  })

  return { salon, service, member, user }
}

/**
 * Crée une session en base et renvoie le jeton en clair, à poser en cookie.
 *
 * Évite de rejouer le formulaire de connexion dans chaque test : seul le test
 * dédié à l'authentification passe par l'interface.
 */
export async function createSessionToken(userId: string): Promise<string> {
  const token = randomBytes(32).toString('base64url')
  await e2eDb.session.create({
    data: {
      userId,
      sessionToken: createHash('sha256').update(token).digest('hex'),
      expires: new Date(Date.now() + 3_600_000),
    },
  })
  return token
}
