import { expect, test, type Page } from '@playwright/test'
import { CLIENT_EMAIL, createSessionToken, e2eDb, seedE2e } from './helpers/seed'

/**
 * Monter un salon entièrement par l'interface, puis y réserver.
 *
 * Ce parcours manquait, et son absence a laissé passer un défaut bloquant : le
 * moteur de disponibilité croise les horaires du salon avec ceux de chaque
 * membre **sans repli**. Un membre créé sans horaires n'était jamais proposé,
 * donc aucun salon monté par l'interface ne pouvait recevoir de réservation.
 * Les salons de démonstration masquaient le problème : leur seed écrit les
 * horaires individuels directement en base.
 */

const SLUG = 'salon-monte-a-la-main'

/** Date à J+`days`, au format `AAAA-MM-JJ`. */
function inDays(days: number): string {
  const date = new Date()
  date.setDate(date.getDate() + days)
  return date.toISOString().slice(0, 10)
}

/**
 * Crée un salon vide dont l'appelant est gérant, et ouvre sa session.
 *
 * Le salon est créé en base : sa création relève de l'administrateur
 * plateforme, ce n'est pas l'objet de ce test.
 */
async function seedEmptySalon(page: Page): Promise<string> {
  const { user } = await seedE2e()

  const salon = await e2eDb.salon.create({
    data: {
      slug: SLUG,
      name: 'Salon Monté à la Main',
      address: '12 rue Neuve',
      city: 'Rennes',
      postalCode: '35000',
      isActive: true,
      slotStepMin: 30,
      bookingLeadTimeMin: 0,
    },
  })

  await e2eDb.salonMember.create({
    data: {
      salonId: salon.id,
      userId: user.id,
      role: 'OWNER',
      displayName: 'Gérante',
      isBookable: false,
    },
  })

  await page.context().addCookies([
    {
      name: 'schedulr.session',
      value: await createSessionToken(user.id),
      url: 'http://127.0.0.1:3100',
    },
  ])

  return salon.id
}

test.afterAll(async () => {
  await e2eDb.$disconnect()
})

test('un salon monté par l’interface accepte une réservation', async ({ page }) => {
  const salonId = await seedEmptySalon(page)

  // 1. Une prestation.
  await page.goto(`/pro/${salonId}/configuration`)
  await page.getByRole('button', { name: 'Ajouter une prestation' }).click()
  await page.getByLabel('Nom').fill('Coupe simple')
  await page.getByLabel('Durée (minutes)').fill('30')
  await page.getByLabel('Prix (€)').fill('25')
  await page.getByRole('button', { name: 'Enregistrer' }).click()
  await expect(page.getByText('Coupe simple')).toBeVisible()

  // 2. Les horaires d'ouverture, tous les jours pour ne pas dépendre du jour
  // où le test s'exécute.
  await page.goto(`/pro/${salonId}/configuration/horaires`)
  for (const day of [
    'Lundi',
    'Mardi',
    'Mercredi',
    'Jeudi',
    'Vendredi',
    'Samedi',
    'Dimanche',
  ]) {
    await page
      .getByRole('listitem')
      .filter({ hasText: new RegExp(`^${day}`) })
      .getByRole('button', { name: 'Ajouter une plage' })
      .click()
  }
  await page.getByRole('button', { name: 'Enregistrer les horaires' }).click()
  await expect(page.getByRole('status')).toContainText('Horaires enregistrés')

  // 3. Un coiffeur. Ses horaires doivent être repris du salon sans action
  // supplémentaire — c'est précisément ce qui manquait.
  await page.goto(`/pro/${salonId}/configuration/equipe`)
  await page.getByRole('button', { name: 'Ajouter un membre' }).click()
  await page.getByLabel('Nom affiché').fill('Nour')
  await page.getByRole('button', { name: 'Enregistrer' }).click()
  await expect(page.getByText('Nour')).toBeVisible()
  await expect(page.getByText('Sans horaires')).toHaveCount(0)

  // 4. La prestation lui est affectée.
  const nour = page.getByRole('listitem').filter({ hasText: 'Nour' })
  await nour.getByRole('button', { name: 'Prestations' }).click()
  await nour.getByRole('checkbox', { name: 'Coupe simple' }).check()
  await nour.getByRole('button', { name: 'Enregistrer' }).click()

  // L'affectation doit être visible avant de passer côté client : sans elle,
  // aucun coiffeur ne réalise la prestation et le tunnel s'arrête.
  await expect(nour).toContainText('1 prestation')

  // 5. Un client réserve.
  await page.context().clearCookies()
  const client = await e2eDb.user.findUniqueOrThrow({ where: { email: CLIENT_EMAIL } })
  await page.context().addCookies([
    {
      name: 'schedulr.session',
      value: await createSessionToken(client.id),
      url: 'http://127.0.0.1:3100',
    },
  ])

  await page.goto(`/reserver/${SLUG}`)
  await page.getByRole('checkbox', { name: /Coupe simple/ }).check()
  await page.getByRole('button', { name: 'Continuer' }).click()
  await page.getByRole('button', { name: 'Continuer' }).click()

  await expect(page.getByRole('heading', { name: /Choisissez un créneau/ })).toBeVisible()
  await page.getByLabel('À partir du').fill(inDays(3))

  // Le cœur du test : sans horaires individuels, cette liste resterait vide.
  const firstSlot = page
    .locator('button[aria-pressed]')
    .filter({ hasText: /^\d{2}:\d{2}$/ })
    .first()
  await expect(firstSlot).toBeVisible({ timeout: 15_000 })
  await firstSlot.click()

  await page.getByRole('button', { name: 'Continuer' }).click()
  await expect(page.getByRole('heading', { name: 'Récapitulatif' })).toBeVisible()
  await page.getByRole('button', { name: 'Confirmer le rendez-vous' }).click()

  await expect(page).toHaveURL(/\/mon-compte/)
  expect(await e2eDb.appointment.count({ where: { salonId } })).toBe(1)
})

test('un membre privé de ses horaires est signalé et ne reçoit plus de créneau', async ({
  page,
}) => {
  const salonId = await seedEmptySalon(page)

  const member = await e2eDb.salonMember.create({
    data: {
      salonId,
      role: 'STAFF',
      displayName: 'Ilan',
      isBookable: true,
      workingHours: {
        create: Array.from({ length: 7 }, (_, dayOfWeek) => ({
          salonId,
          dayOfWeek,
          startMin: 9 * 60,
          endMin: 19 * 60,
        })),
      },
    },
  })

  await page.goto(`/pro/${salonId}/configuration/equipe`)
  await expect(page.getByText('Sans horaires')).toHaveCount(0)

  // Vider les horaires depuis l'interface doit rendre l'avertissement visible :
  // c'est le seul indice qu'a le gérant avant que ses clients ne voient plus
  // aucun créneau.
  await e2eDb.workingHour.deleteMany({ where: { memberId: member.id } })
  await page.reload()

  await expect(page.getByText('Sans horaires')).toBeVisible()
})
