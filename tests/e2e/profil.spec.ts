import { expect, test, type Page } from '@playwright/test'
import { CLIENT_EMAIL, createSessionToken, e2eDb, seedE2e } from './helpers/seed'

/**
 * Profil du client et accès aux SMS.
 *
 * Le consentement aux SMS était jusqu'ici impossible à donner : la case
 * renvoyait à un profil qui n'existait pas, et aucun écran ne collectait de
 * numéro. Tout le canal SMS restait donc hors d'atteinte.
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

test('renseigner un téléphone débloque le consentement aux SMS', async ({ page }) => {
  await signIn(page)

  // Sans numéro, la case est inopérante et renvoie vers le profil.
  await page.goto('/mon-compte')
  const consent = page.getByRole('checkbox', { name: /rappel par SMS/ })
  await expect(consent).toBeDisabled()

  await page.getByRole('link', { name: 'numéro de téléphone' }).click()
  await expect(page).toHaveURL(/\/mon-compte\/profil/)

  await page.getByLabel(/Téléphone/).fill('06 12 34 56 78')
  await page.getByRole('button', { name: 'Enregistrer' }).click()
  await expect(page.getByRole('status')).toContainText('Profil enregistré')

  // Le numéro est stocké au format international, seul accepté par Twilio.
  const user = await e2eDb.user.findUniqueOrThrow({ where: { id: userId } })
  expect(user.phone).toBe('+33612345678')

  await page.goto('/mon-compte')
  await expect(consent).toBeEnabled()
  await consent.check()

  await expect
    .poll(() => e2eDb.consentRecord.count({ where: { userId, granted: true } }))
    .toBe(1)
})

test('un numéro invalide est refusé avec un message utile', async ({ page }) => {
  await signIn(page)
  await page.goto('/mon-compte/profil')

  await page.getByLabel(/Téléphone/).fill('06 12')
  await page.getByRole('button', { name: 'Enregistrer' }).click()

  await expect(page.getByRole('alert').first()).toContainText(/Numéro invalide/)
  expect((await e2eDb.user.findUniqueOrThrow({ where: { id: userId } })).phone).toBeNull()
})

test('le profil se modifie sans toucher à l’adresse électronique', async ({ page }) => {
  await signIn(page)
  await page.goto('/mon-compte/profil')

  await expect(page.getByText(CLIENT_EMAIL)).toBeVisible()

  await page.getByLabel('Prénom', { exact: true }).fill('Camille-Renommée')
  await page.getByRole('button', { name: 'Enregistrer' }).click()
  await expect(page.getByRole('status')).toContainText('Profil enregistré')

  const user = await e2eDb.user.findUniqueOrThrow({ where: { id: userId } })
  expect(user.firstName).toBe('Camille-Renommée')
  expect(user.email).toBe(CLIENT_EMAIL)
})

test('l’inscription accepte un téléphone dès la création du compte', async ({ page }) => {
  await page.goto('/inscription')

  await page.getByLabel('Prénom', { exact: true }).fill('Nouveau')
  await page.getByLabel('Nom', { exact: true }).fill('Client')
  await page.getByLabel(/Téléphone/).fill('07 65 43 21 09')
  await page.getByLabel('Adresse électronique').fill('nouveau.client@example.fr')
  await page.getByLabel('Mot de passe').fill('mot-de-passe-e2e-2026')
  await page.getByRole('button', { name: 'Créer mon compte' }).click()

  await expect(page).toHaveURL(/\/mon-compte/)

  const user = await e2eDb.user.findUniqueOrThrow({
    where: { email: 'nouveau.client@example.fr' },
  })
  expect(user.phone).toBe('+33765432109')
})
