import { createHash, randomBytes } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { CLIENT_EMAIL, e2eDb, seedE2e } from './helpers/seed'

/**
 * Crée un lien de connexion directement dans la base du serveur E2E.
 *
 * On n'importe pas `createMagicLinkToken` : ce module utilise le client Prisma
 * global, qui lit le `DATABASE_URL` du processus de test — différent de celui
 * du serveur. Le jeton serait écrit dans la mauvaise base.
 */
async function seedMagicLink(email: string): Promise<string> {
  const token = randomBytes(32).toString('base64url')
  await e2eDb.verificationToken.create({
    data: {
      identifier: email.toLowerCase(),
      token: createHash('sha256').update(token).digest('hex'),
      expires: new Date(Date.now() + 15 * 60_000),
    },
  })
  return token
}

/**
 * Connexion sans mot de passe.
 *
 * Le jeton est créé directement en base : le courriel ne part pas en test, le
 * coupe-circuit `NOTIFICATIONS_ENABLED` étant ouvert.
 */

test.beforeEach(async () => {
  await seedE2e()
  await e2eDb.verificationToken.deleteMany({})
})

test.afterAll(async () => {
  await e2eDb.$disconnect()
})

test('un lien valide ouvre une session', async ({ page }) => {
  const token = await seedMagicLink(CLIENT_EMAIL)

  await page.goto(`/api/connexion/lien?jeton=${encodeURIComponent(token)}`)

  await expect(page).toHaveURL(/\/mon-compte/)
  await expect(page.getByRole('heading', { name: 'Mes rendez-vous' })).toBeVisible()
})

test('un lien déjà utilisé est refusé', async ({ page }) => {
  const token = await seedMagicLink(CLIENT_EMAIL)
  await page.goto(`/api/connexion/lien?jeton=${encodeURIComponent(token)}`)
  await expect(page).toHaveURL(/\/mon-compte/)

  // Nouvelle navigation avec le même lien, session effacée.
  await page.context().clearCookies()
  await page.goto(`/api/connexion/lien?jeton=${encodeURIComponent(token)}`)

  await expect(page).toHaveURL(/lien=expire/)
  // La page porte aussi l'alerte du formulaire mot de passe : on vise celle du
  // lien, pas la première venue.
  await expect(
    page.getByRole('alert').filter({ hasText: 'n’est plus valable' }),
  ).toBeVisible()
})

test('un lien inconnu est refusé', async ({ page }) => {
  await page.goto('/api/connexion/lien?jeton=nimporte-quoi')

  await expect(page).toHaveURL(/lien=expire/)
})

test('la demande de lien ne révèle pas si le compte existe', async ({ page }) => {
  // Le même message dans les deux cas : distinguer permettrait d'énumérer les
  // comptes.
  await page.goto('/connexion')
  await page.getByRole('button', { name: 'Se connecter sans mot de passe' }).click()
  await page
    .getByLabel('Adresse électronique', { exact: true })
    .last()
    .fill('inconnu@example.fr')
  await page.getByRole('button', { name: 'Recevoir un lien de connexion' }).click()

  await expect(page.getByRole('status')).toContainText(/Si un compte existe/)
  // Aucun jeton n'a été créé pour une adresse inconnue.
  expect(await e2eDb.verificationToken.count()).toBe(0)
})
