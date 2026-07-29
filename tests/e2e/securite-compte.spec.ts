import { createHash, randomBytes } from 'node:crypto'
import { expect, test, type Page } from '@playwright/test'
import {
  CLIENT_EMAIL,
  CLIENT_PASSWORD,
  createSessionToken,
  e2eDb,
  seedE2e,
} from './helpers/seed'

/**
 * Sécurité du compte, vue de l'utilisateur.
 *
 * Avant ce lot, un compte compromis n'avait aucun recours : ni changement de
 * mot de passe, ni fermeture des sessions ouvertes ailleurs.
 */

let userId: string

test.beforeEach(async () => {
  const { user } = await seedE2e()
  userId = user.id
})

test.afterAll(async () => {
  await e2eDb.$disconnect()
})

async function signIn(page: Page): Promise<void> {
  await page.context().addCookies([
    {
      name: 'schedulr.session',
      value: await createSessionToken(userId),
      url: 'http://127.0.0.1:3100',
    },
  ])
}

test('changer son mot de passe ferme toutes les sessions', async ({ page }) => {
  await signIn(page)
  // Une session ouverte ailleurs — celle d'un éventuel intrus.
  await createSessionToken(userId)

  await page.goto('/mon-compte/profil')
  await page.getByLabel('Mot de passe actuel').fill(CLIENT_PASSWORD)
  await page.getByLabel('Nouveau mot de passe').fill('nouveau-mot-de-passe-2026')
  await page.getByRole('button', { name: 'Changer mon mot de passe' }).click()

  await expect(page).toHaveURL(/motdepasse=change/)
  await expect(page.getByRole('status')).toContainText(/sessions ont été fermées/)

  // Aucune session ne survit, pas même celle de l'intrus.
  expect(await e2eDb.session.count({ where: { userId } })).toBe(0)

  // Et le nouveau mot de passe fonctionne.
  await page.getByLabel('Adresse électronique', { exact: true }).fill(CLIENT_EMAIL)
  await page.getByLabel('Mot de passe', { exact: true }).fill('nouveau-mot-de-passe-2026')
  await page.getByRole('button', { name: 'Se connecter', exact: true }).click()
  await expect(page).toHaveURL(/\/mon-compte/)
})

test('un mot de passe actuel erroné est refusé', async ({ page }) => {
  await signIn(page)

  await page.goto('/mon-compte/profil')
  await page.getByLabel('Mot de passe actuel').fill('ce-n-est-pas-le-bon')
  await page.getByLabel('Nouveau mot de passe').fill('nouveau-mot-de-passe-2026')
  await page.getByRole('button', { name: 'Changer mon mot de passe' }).click()

  await expect(
    page.getByRole('alert').filter({ hasText: 'Mot de passe actuel incorrect' }),
  ).toBeVisible()
  expect(await e2eDb.session.count({ where: { userId } })).toBeGreaterThan(0)
})

test('fermer toutes ses sessions déconnecte', async ({ page }) => {
  await signIn(page)
  await createSessionToken(userId)

  await page.goto('/mon-compte/profil')
  await page.getByRole('button', { name: 'Fermer toutes mes sessions' }).click()

  await expect(page).toHaveURL(/sessions=fermees/)
  expect(await e2eDb.session.count({ where: { userId } })).toBe(0)
})

test('confirmer son adresse lève l’avertissement', async ({ page }) => {
  // Le seed marque l'adresse comme vérifiée : on revient en arrière pour
  // rejouer le parcours d'un compte fraîchement inscrit.
  await e2eDb.user.update({ where: { id: userId }, data: { emailVerified: null } })
  await signIn(page)

  await page.goto('/mon-compte/profil')
  await expect(page.getByText(/n’est pas confirmée/)).toBeVisible()

  const token = randomBytes(32).toString('base64url')
  await e2eDb.verificationToken.create({
    data: {
      identifier: CLIENT_EMAIL,
      token: createHash('sha256').update(token).digest('hex'),
      purpose: 'EMAIL_VERIFICATION',
      expires: new Date(Date.now() + 3_600_000),
    },
  })

  await page.goto(`/api/compte/verification?jeton=${encodeURIComponent(token)}`)
  await expect(page).toHaveURL(/adresse=confirmee/)
  await expect(page.getByRole('status')).toContainText(/adresse est confirmée/)

  await page.goto('/mon-compte/profil')
  await expect(page.getByText(/n’est pas confirmée/)).toHaveCount(0)
})

test('un lien de confirmation périmé est refusé', async ({ page }) => {
  await signIn(page)

  await page.goto('/api/compte/verification?jeton=nimporte-quoi')

  await expect(page).toHaveURL(/adresse=expiree/)
  await expect(
    page.getByRole('alert').filter({ hasText: /n’est plus valable/ }),
  ).toBeVisible()
})
