import { expect, test, type Page } from '@playwright/test'
import { OWNER_EMAIL, createSessionToken, e2eDb, seedE2e } from './helpers/seed'

/**
 * Navigation entre les espaces, et pages qui n'ont rien à montrer.
 *
 * Une même personne est cliente ici et gérante là. Sans liens dans l'en-tête,
 * passer d'un espace à l'autre exigeait de modifier l'URL à la main.
 */

test.afterAll(async () => {
  await e2eDb.$disconnect()
})

async function signInAs(page: Page, email: string): Promise<string> {
  const user = await e2eDb.user.findUniqueOrThrow({ where: { email } })
  await page.context().addCookies([
    {
      name: 'schedulr.session',
      value: await createSessionToken(user.id),
      url: 'http://127.0.0.1:3100',
    },
  ])
  return user.id
}

test('la gérante passe de ses rendez-vous à son espace professionnel', async ({
  page,
}) => {
  await seedE2e()
  await signInAs(page, OWNER_EMAIL)

  await page.goto('/mon-compte')
  const spaces = page.getByRole('navigation', { name: 'Espaces' })
  await expect(spaces.getByRole('link', { name: 'Espace pro' })).toBeVisible()

  await spaces.getByRole('link', { name: 'Espace pro' }).click()
  await expect(page).toHaveURL(/\/pro$/)

  // Et retour, sans passer par l'URL.
  await spaces.getByRole('link', { name: 'Mes rendez-vous' }).click()
  await expect(page).toHaveURL(/\/mon-compte/)
})

test('un client ne voit ni espace professionnel ni administration', async ({ page }) => {
  const { user } = await seedE2e()
  await page.context().addCookies([
    {
      name: 'schedulr.session',
      value: await createSessionToken(user.id),
      url: 'http://127.0.0.1:3100',
    },
  ])

  await page.goto('/mon-compte')
  const spaces = page.getByRole('navigation', { name: 'Espaces' })

  await expect(spaces.getByRole('link', { name: 'Mes rendez-vous' })).toBeVisible()
  await expect(spaces.getByRole('link', { name: 'Espace pro' })).toHaveCount(0)
  await expect(spaces.getByRole('link', { name: 'Administration' })).toHaveCount(0)
})

test('l’agenda d’un salon ramène à la liste des salons', async ({ page }) => {
  const { salon } = await seedE2e()
  await signInAs(page, OWNER_EMAIL)

  await page.goto(`/pro/${salon.id}`)
  await page.getByRole('link', { name: '← Mes salons' }).click()

  await expect(page).toHaveURL(/\/pro$/)
})

test('une adresse inconnue affiche une page 404 utilisable', async ({ page }) => {
  const response = await page.goto('/cette-page-nexiste-pas')

  expect(response?.status()).toBe(404)
  await expect(page.getByRole('heading', { name: 'Page introuvable' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Retour à l’accueil' })).toBeVisible()
})

test('un salon sans prestation n’invite pas à réserver', async ({ page }) => {
  await seedE2e()

  const salon = await e2eDb.salon.create({
    data: {
      slug: 'salon-vide-vitrine',
      name: 'Salon Sans Prestation',
      address: '1 rue Vide',
      city: 'Nantes',
      postalCode: '44000',
      phone: '+33240000000',
      isActive: true,
    },
  })

  await page.goto(`/salon/${salon.slug}`)

  // Le bouton mènerait à un tunnel incapable de proposer le moindre créneau.
  await expect(page.getByRole('link', { name: 'Prendre rendez-vous' })).toHaveCount(0)
  await expect(
    page.getByText(/réservation en ligne n’est pas encore ouverte/),
  ).toBeVisible()
  await expect(page.getByText(/pas encore publié ses prestations/)).toBeVisible()

  await e2eDb.salon.delete({ where: { id: salon.id } })
})

test('les mentions légales sont accessibles depuis le pied de page', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Mentions légales' }).click()

  await expect(page).toHaveURL(/\/mentions-legales/)
  await expect(page.getByRole('heading', { name: 'Mentions légales' })).toBeVisible()

  // Le gabarit signale ce qui reste à renseigner plutôt que d'inventer.
  await expect(page.getByText(/À COMPLÉTER/).first()).toBeVisible()
})

test('la recherche publique trouve un salon par sa prestation', async ({ page }) => {
  await seedE2e()

  await page.goto('/')
  await page.getByRole('searchbox').fill('Coupe femme')
  await page.getByRole('button', { name: 'Rechercher' }).click()

  await expect(page.getByRole('heading', { name: 'Salon Bout-en-Bout' })).toBeVisible()
})

test('aucun écran ne déborde horizontalement sur téléphone', async ({ page }) => {
  // `/admin/comptes` débordait de 49 pixels : son tableau faisait défiler la
  // page entière au lieu de défiler lui-même.
  await seedE2e()
  await signInAs(page, OWNER_EMAIL)
  await page.setViewportSize({ width: 375, height: 667 })

  const salon = await e2eDb.salon.findFirstOrThrow({ where: { slug: 'salon-e2e' } })

  for (const path of [
    '/',
    '/mon-compte',
    '/mon-compte/profil',
    `/pro/${salon.id}`,
    `/pro/${salon.id}/configuration/equipe`,
  ]) {
    await page.goto(path)
    const measured = await page.evaluate(() => ({
      document: document.documentElement.scrollWidth,
      window: window.innerWidth,
    }))
    expect(measured.document, `${path} déborde`).toBeLessThanOrEqual(measured.window + 1)
  }
})
