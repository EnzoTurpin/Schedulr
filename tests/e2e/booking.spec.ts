import { expect, test, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import {
  CLIENT_EMAIL,
  CLIENT_PASSWORD,
  SALON_SLUG,
  createSessionToken,
  e2eDb,
  seedE2e,
} from './helpers/seed'

/**
 * Parcours client de bout en bout — critère d'acceptation de la phase 3 :
 * réserver, voir la confirmation, annuler.
 *
 * Ces tests exercent l'application compilée en production, avec sa vraie base.
 */

let userId: string

test.beforeEach(async () => {
  const { user } = await seedE2e()
  userId = user.id
})

test.afterAll(async () => {
  await e2eDb.$disconnect()
})

/** Pose un cookie de session valide, sans passer par le formulaire. */
async function signIn(page: Page) {
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

/** Date à J+`days`, au format `AAAA-MM-JJ`. */
function inDays(days: number): string {
  const date = new Date()
  date.setDate(date.getDate() + days)
  return date.toISOString().slice(0, 10)
}

/**
 * Déroule le tunnel jusqu'à la confirmation.
 *
 * Vise un créneau à J+3 : le délai d'annulation du salon est de 24 h, un
 * rendez-vous du jour même ne serait pas annulable et le parcours ne pourrait
 * pas être joué jusqu'au bout.
 */
async function bookFirstAvailableSlot(page: Page) {
  await page.goto(`/reserver/${SALON_SLUG}`)

  await page.getByRole('checkbox', { name: /Coupe femme/ }).check()
  await page.getByRole('button', { name: 'Continuer' }).click()

  await expect(
    page.getByRole('heading', { name: /Choisissez votre coiffeur/ }),
  ).toBeVisible()
  await page.getByRole('button', { name: 'Continuer' }).click()

  await expect(page.getByRole('heading', { name: /Choisissez un créneau/ })).toBeVisible()
  await page.getByLabel('À partir du').fill(inDays(3))

  const firstSlot = page
    .locator('button[aria-pressed]')
    .filter({ hasText: /^\d{2}:\d{2}$/ })
    .first()
  await expect(firstSlot).toBeVisible({ timeout: 15_000 })
  const slotLabel = (await firstSlot.textContent())?.trim()
  await firstSlot.click()

  await page.getByRole('button', { name: 'Continuer' }).click()
  await expect(page.getByRole('heading', { name: 'Récapitulatif' })).toBeVisible()

  return slotLabel
}

test('un visiteur trouve un salon depuis la recherche', async ({ page }) => {
  await page.goto('/')

  await page.getByRole('searchbox').fill('Lyon')
  await page.getByRole('button', { name: 'Rechercher' }).click()

  await expect(page.getByRole('heading', { name: 'Salon Bout-en-Bout' })).toBeVisible()

  await page.getByRole('link', { name: /Salon Bout-en-Bout/ }).click()
  await expect(page).toHaveURL(new RegExp(`/salon/${SALON_SLUG}$`))
  await expect(page.getByText('Coupe femme')).toBeVisible()
})

test('la fiche salon expose des données structurées', async ({ page }) => {
  // Le référencement des fiches est le principal canal d'acquisition
  // (ADR-0001) : la régression serait invisible à l'œil nu.
  await page.goto(`/salon/${SALON_SLUG}`)

  const jsonLd = await page.locator('script[type="application/ld+json"]').textContent()
  const data = JSON.parse(jsonLd ?? '{}')

  expect(data['@type']).toBe('HairSalon')
  expect(data.name).toBe('Salon Bout-en-Bout')
  expect(data.address.addressLocality).toBe('Lyon')
  expect(data.openingHoursSpecification).toHaveLength(7)
})

test('un visiteur non connecté est renvoyé vers la connexion puis revient au tunnel', async ({
  page,
}) => {
  await page.goto(`/reserver/${SALON_SLUG}`)

  await expect(page).toHaveURL(/\/connexion\?suite=/)

  await page.getByLabel('Adresse électronique').fill(CLIENT_EMAIL)
  await page.getByLabel('Mot de passe').fill(CLIENT_PASSWORD)
  await page.getByRole('button', { name: 'Se connecter' }).click()

  // La destination d'origine est honorée, plutôt que l'espace client.
  await expect(page).toHaveURL(new RegExp(`/reserver/${SALON_SLUG}$`))
})

test('un client réserve, voit la confirmation, puis annule', async ({ page }) => {
  await signIn(page)

  const slotLabel = await bookFirstAvailableSlot(page)

  await expect(page.getByText('Coupe femme')).toBeVisible()
  await expect(page.getByText('35,00 €')).toBeVisible()

  await page.getByRole('button', { name: 'Confirmer le rendez-vous' }).click()

  // Confirmation
  await expect(page).toHaveURL(/\/mon-compte\?reservation=/)
  await expect(page.getByText('Votre rendez-vous est confirmé')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Salon Bout-en-Bout' })).toBeVisible()
  if (slotLabel) {
    await expect(page.getByText(slotLabel, { exact: false })).toBeVisible()
  }

  expect(await e2eDb.appointment.count({ where: { status: 'CONFIRMED' } })).toBe(1)

  // Annulation
  await page.getByRole('button', { name: 'Annuler ce rendez-vous' }).click()
  await page.getByRole('button', { name: 'Oui, annuler' }).click()

  await expect(page.getByText('Aucun rendez-vous à venir')).toBeVisible()
  expect(await e2eDb.appointment.count({ where: { status: 'CANCELLED' } })).toBe(1)
})

test('un créneau pris entre-temps est refusé et la liste est rechargée', async ({
  page,
}) => {
  // Simule la course réelle : le créneau est réservé côté base pendant que le
  // client est sur l'écran de confirmation.
  await signIn(page)
  await bookFirstAvailableSlot(page)

  const member = await e2eDb.salonMember.findFirstOrThrow()
  const salon = await e2eDb.salon.findFirstOrThrow()
  const summary = await page.getByRole('heading', { name: 'Récapitulatif' })
  await expect(summary).toBeVisible()

  // On occupe toute la journée visée par le tunnel (J+3).
  const day = new Date(`${inDays(3)}T00:00:00Z`)
  await e2eDb.appointment.create({
    data: {
      salonId: salon.id,
      memberId: member.id,
      startAt: new Date(day.getTime() + 5 * 3_600_000),
      endAt: new Date(day.getTime() + 20 * 3_600_000),
    },
  })

  await page.getByRole('button', { name: 'Confirmer le rendez-vous' }).click()

  await expect(page.locator('p[role="alert"]')).toContainText(
    /n’est plus disponible|vient d’être/,
  )
  // L'interface est revenue au choix du créneau, pas bloquée sur un écran mort.
  await expect(page.getByRole('heading', { name: /Choisissez un créneau/ })).toBeVisible()
})

test('les écrans clés n’ont aucune violation d’accessibilité bloquante', async ({
  page,
}) => {
  await signIn(page)

  for (const path of ['/', `/salon/${SALON_SLUG}`, '/connexion', '/mon-compte']) {
    await page.goto(path)
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa'])
      .analyze()

    expect(
      results.violations.map((v) => `${path} — ${v.id}: ${v.description}`),
      `violations sur ${path}`,
    ).toEqual([])
  }
})

test('le tunnel est utilisable entièrement au clavier', async ({ page }) => {
  // Exigence WCAG 2.1 AA retenue pour le projet : tout ce qui se fait à la
  // souris doit se faire au clavier.
  await signIn(page)
  await page.goto(`/reserver/${SALON_SLUG}`)

  const checkbox = page.getByRole('checkbox', { name: /Coupe femme/ })
  await checkbox.focus()
  await page.keyboard.press('Space')
  await expect(checkbox).toBeChecked()

  await page.getByRole('button', { name: 'Continuer' }).focus()
  await page.keyboard.press('Enter')

  await expect(
    page.getByRole('heading', { name: /Choisissez votre coiffeur/ }),
  ).toBeVisible()
})
