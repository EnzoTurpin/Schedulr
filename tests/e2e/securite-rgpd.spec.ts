import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import { CLIENT_EMAIL, createSessionToken, e2eDb, seedE2e } from './helpers/seed'

/**
 * Durcissement et conformité.
 *
 * Vérifie les protections que rien d'autre ne montre : en-têtes de sécurité,
 * limitation de débit, droits des personnes.
 */

let clientId: string

test.beforeEach(async () => {
  const { user } = await seedE2e()
  clientId = user.id
})

test.afterAll(async () => {
  await e2eDb.$disconnect()
})

async function signIn(page: Page, userId: string) {
  const token = await createSessionToken(userId)
  await page.context().addCookies([
    {
      name: 'schedulr.session',
      value: token,
      domain: '127.0.0.1',
      path: '/',
      httpOnly: true,
      sameSite: 'Lax',
    },
  ])
}

test('les en-têtes de sécurité sont posés sur les pages publiques', async ({
  request,
}) => {
  const response = await request.get('/')
  const headers = response.headers()

  const csp = headers['content-security-policy']
  expect(csp).toBeDefined()
  // Aucune ressource externe : l'application n'en charge aucune.
  expect(csp).toContain("default-src 'self'")
  // Trois vecteurs d'injection fermés.
  expect(csp).toContain("object-src 'none'")
  expect(csp).toContain("frame-ancestors 'none'")
  expect(csp).toContain("base-uri 'self'")

  expect(headers['x-content-type-options']).toBe('nosniff')
  expect(headers['x-frame-options']).toBe('DENY')
  expect(headers['referrer-policy']).toBe('strict-origin-when-cross-origin')
})

test('le cookie de session est inaccessible au JavaScript', async ({ page }) => {
  await signIn(page, clientId)
  await page.goto('/mon-compte')

  // `httpOnly` : un script injecté ne peut pas voler la session.
  const visible = await page.evaluate(() => document.cookie)
  expect(visible).not.toContain('schedulr.session')

  const cookies = await page.context().cookies()
  const session = cookies.find((c) => c.name === 'schedulr.session')
  expect(session?.httpOnly).toBe(true)
  expect(session?.sameSite).toBe('Lax')
})

test('les tentatives de connexion répétées sont bloquées', async ({ page }) => {
  await page.goto('/connexion')

  // On cible notre alerte : Next.js injecte son propre role="alert" pour
  // annoncer les changements de route, qui reste vide.
  const alert = page.locator('p[role="alert"]')

  // La règle autorise cinq essais par quart d'heure.
  //
  // Chaque soumission est attendue explicitement : l'alerte reste affichée
  // entre deux essais, si bien qu'une simple assertion de visibilité passerait
  // sans qu'aucune nouvelle requête n'ait eu lieu.
  for (let attempt = 0; attempt < 6; attempt++) {
    await page.getByLabel('Adresse électronique').fill(CLIENT_EMAIL)
    await page.getByLabel('Mot de passe').fill(`mauvais-mot-de-passe-${attempt}`)

    await Promise.all([
      page.waitForResponse(
        (response) => response.request().method() === 'POST' && response.status() < 400,
      ),
      page.getByRole('button', { name: 'Se connecter' }).click(),
    ])
  }

  await expect(alert).toContainText(/Trop de tentatives/)
})

test('le client télécharge ses données personnelles', async ({ page }) => {
  await signIn(page, clientId)

  const response = await page.request.get('/api/mon-compte/donnees')

  expect(response.status()).toBe(200)
  expect(response.headers()['cache-control']).toContain('no-store')

  const data = await response.json()
  expect(data.account.email).toBe(CLIENT_EMAIL)
  expect(data).toHaveProperty('consents')
  expect(data).toHaveProperty('appointments')
  // Jamais l'empreinte du mot de passe.
  expect(JSON.stringify(data)).not.toContain('argon2')
})

test('un visiteur non connecté ne peut pas télécharger de données', async ({
  request,
}) => {
  const response = await request.get('/api/mon-compte/donnees')

  expect(response.status()).toBe(401)
})

test('le client supprime son compte après confirmation', async ({ page }) => {
  await signIn(page, clientId)
  await page.goto('/mon-compte')

  await page.getByRole('button', { name: 'Supprimer mon compte' }).click()

  // Le bouton reste inactif tant que la confirmation n'est pas saisie.
  const confirm = page.getByRole('button', { name: 'Supprimer mon compte' }).last()
  await expect(confirm).toBeDisabled()

  await page.getByLabel(/Saisissez/).fill('SUPPRIMER')
  await confirm.click()

  await expect(page).toHaveURL(/compte=supprime/)

  const erased = await e2eDb.user.findUniqueOrThrow({ where: { id: clientId } })
  expect(erased.firstName).toBeNull()
  expect(erased.email).not.toBe(CLIENT_EMAIL)
  expect(erased.deletedAt).not.toBeNull()
})

test('la politique de confidentialité est publique et accessible', async ({ page }) => {
  await page.goto('/confidentialite')

  await expect(
    page.getByRole('heading', { name: 'Politique de confidentialité' }),
  ).toBeVisible()
  await expect(page.getByText(/Rendez-vous : 3 ans/)).toBeVisible()

  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze()
  expect(results.violations.map((v) => v.id)).toEqual([])
})

test('la route de purge refuse un appel sans secret', async ({ request }) => {
  // Une purge provoquée par un tiers détruirait des données.
  const response = await request.get('/api/cron/purge')

  expect(response.status()).toBe(401)
})
