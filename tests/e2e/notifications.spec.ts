import { expect, test, type Page } from '@playwright/test'
import { createSessionToken, e2eDb, seedE2e } from './helpers/seed'

/**
 * Notifications — parcours client.
 *
 * Les fournisseurs sont inertes en test (`NOTIFICATIONS_ENABLED=false`) :
 * aucun message ne part, mais le journal des envois est bien alimenté. C'est
 * lui que ces tests vérifient.
 */

let clientId: string
let salonSlug: string

test.beforeEach(async () => {
  const { user, salon } = await seedE2e()
  clientId = user.id
  salonSlug = salon.slug
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

/** Date à J+`days`, au format `AAAA-MM-JJ`. */
function inDays(days: number): string {
  const date = new Date()
  date.setDate(date.getDate() + days)
  return date.toISOString().slice(0, 10)
}

test('une réservation déclenche une confirmation par courriel', async ({ page }) => {
  await signIn(page, clientId)
  await page.goto(`/reserver/${salonSlug}`)

  await page.getByRole('checkbox', { name: /Coupe femme/ }).check()
  await page.getByRole('button', { name: 'Continuer' }).click()
  await page.getByRole('button', { name: 'Continuer' }).click()
  await page.getByLabel('À partir du').fill(inDays(3))

  const slot = page
    .locator('button[aria-pressed]')
    .filter({ hasText: /^\d{2}:\d{2}$/ })
    .first()
  await expect(slot).toBeVisible({ timeout: 15_000 })
  await slot.click()
  await page.getByRole('button', { name: 'Continuer' }).click()
  await page.getByRole('button', { name: 'Confirmer le rendez-vous' }).click()

  await expect(page).toHaveURL(/\/mon-compte\?reservation=/)

  // Une seule notification, sur le canal courriel : le client n'a pas consenti
  // aux SMS.
  await expect
    .poll(async () =>
      e2eDb.notificationLog.count({ where: { template: 'booking_confirmed' } }),
    )
    .toBe(1)

  const log = await e2eDb.notificationLog.findFirstOrThrow()
  expect(log.channel).toBe('EMAIL')
  expect(log.status).toBe('SENT')
  // Le destinataire n'est jamais stocké en clair.
  expect(log.recipientHash).not.toContain('@')
})

test('le client active puis désactive les rappels par SMS', async ({ page }) => {
  await signIn(page, clientId)
  // Un numéro est nécessaire pour que la case soit utilisable.
  await e2eDb.user.update({
    where: { id: clientId },
    data: { phone: '+33600000000' },
  })

  await page.goto('/mon-compte')
  const toggle = page.getByRole('checkbox', { name: /rappel par SMS/ })
  await expect(toggle).not.toBeChecked()

  await toggle.check()
  await expect
    .poll(async () =>
      e2eDb.consentRecord.count({ where: { type: 'TRANSACTIONAL_SMS', granted: true } }),
    )
    .toBe(1)

  await page.reload()
  await page.getByRole('checkbox', { name: /rappel par SMS/ }).uncheck()

  // L'historique est conservé : deux décisions, pas une mise à jour.
  await expect.poll(async () => e2eDb.consentRecord.count()).toBe(2)
})

test('la case de consentement est inactive sans numéro de téléphone', async ({
  page,
}) => {
  await signIn(page, clientId)
  await page.goto('/mon-compte')

  const toggle = page.getByRole('checkbox', { name: /rappel par SMS/ })

  await expect(toggle).toBeDisabled()
  await expect(page.getByText(/Renseignez d’abord un numéro/)).toBeVisible()
})

test('la route de rappels refuse un appel sans secret', async ({ request }) => {
  // Sans ce contrôle, n'importe qui pourrait provoquer une vague d'envois —
  // et chaque SMS est facturé.
  const response = await request.get('/api/cron/rappels')

  expect(response.status()).toBe(401)
})

test('la route de rappels refuse un secret incorrect', async ({ request }) => {
  const response = await request.get('/api/cron/rappels', {
    headers: { authorization: 'Bearer mauvais-secret' },
  })

  expect(response.status()).toBe(401)
})
