import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import { createSessionToken, e2eDb, seedE2e } from './helpers/seed'

/**
 * Configuration du salon — critère d'acceptation de la phase 5 : un salon est
 * entièrement paramétrable sans intervention technique.
 *
 * Le parcours final vérifie la chaîne complète : une prestation créée depuis
 * l'écran de configuration devient réservable par un client.
 */

let ownerId: string
let clientId: string
let salonId: string
let salonSlug: string

test.beforeEach(async () => {
  const { ownerUser, user, salon } = await seedE2e()
  ownerId = ownerUser.id
  clientId = user.id
  salonId = salon.id
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

test('la gérante crée une prestation depuis la configuration', async ({ page }) => {
  await signIn(page, ownerId)
  await page.goto(`/pro/${salonId}/configuration`)

  await page.getByRole('button', { name: 'Ajouter une prestation' }).click()
  await page.getByLabel('Nom', { exact: true }).fill('Balayage')
  await page.getByLabel('Durée (minutes)').fill('90')
  await page.getByLabel('Prix (€)').fill('95')
  await page.getByLabel('Remise en état après (min)').fill('15')
  await page.getByRole('button', { name: 'Enregistrer' }).click()

  await expect
    .poll(async () => e2eDb.service.count({ where: { name: 'Balayage' } }))
    .toBe(1)

  const created = await e2eDb.service.findFirstOrThrow({ where: { name: 'Balayage' } })
  expect(created.durationMin).toBe(90)
  // Le prix est saisi en euros et stocké en centimes.
  expect(created.priceCents).toBe(9500)
  expect(created.bufferAfterMin).toBe(15)
})

test('la gérante retire une prestation du catalogue', async ({ page }) => {
  await signIn(page, ownerId)
  await page.goto(`/pro/${salonId}/configuration`)

  await page.getByRole('button', { name: 'Retirer' }).click()

  await expect
    .poll(async () => e2eDb.service.count({ where: { isActive: false } }))
    .toBe(1)
})

test('la gérante modifie les horaires d’ouverture', async ({ page }) => {
  await signIn(page, ownerId)
  await page.goto(`/pro/${salonId}/configuration/horaires`)

  // Le seed ouvre 9 h–19 h tous les jours : on décale l'ouverture du lundi.
  await page.getByLabel('Lundi — début, plage 1').fill('10:30')
  await page.getByRole('button', { name: 'Enregistrer les horaires' }).click()

  await expect(page.getByRole('status')).toContainText('Horaires enregistrés')

  const monday = await e2eDb.openingHour.findFirstOrThrow({ where: { dayOfWeek: 1 } })
  expect(monday.startMin).toBe(10 * 60 + 30)
})

test('les horaires incohérents sont refusés avec un message clair', async ({ page }) => {
  await signIn(page, ownerId)
  await page.goto(`/pro/${salonId}/configuration/horaires`)

  // Fermeture avant l'ouverture.
  await page.getByLabel('Lundi — fin, plage 1').fill('07:00')
  await page.getByRole('button', { name: 'Enregistrer les horaires' }).click()

  await expect(page.locator('p[role="alert"]')).toContainText(/doit suivre l’ouverture/)

  // Rien n'a été enregistré.
  const monday = await e2eDb.openingHour.findFirstOrThrow({ where: { dayOfWeek: 1 } })
  expect(monday.endMin).toBe(19 * 60)
})

test('la gérante programme une fermeture exceptionnelle', async ({ page }) => {
  await signIn(page, ownerId)
  await page.goto(`/pro/${salonId}/configuration/horaires`)

  await page.getByLabel('Du').fill('2026-12-24')
  await page.getByLabel('Au (exclu)').fill('2027-01-02')
  await page.getByLabel('Motif').fill('Congés de fin d’année')
  // `exact` : « Ajouter » matcherait les sept boutons « Ajouter une plage ».
  await page.getByRole('button', { name: 'Ajouter', exact: true }).click()

  await expect.poll(async () => e2eDb.closure.count()).toBe(1)
  await expect(page.getByText('Congés de fin d’année')).toBeVisible()
})

test('la gérante ajoute un membre à l’équipe', async ({ page }) => {
  await signIn(page, ownerId)
  await page.goto(`/pro/${salonId}/configuration/equipe`)

  await page.getByRole('button', { name: 'Ajouter un membre' }).click()
  await page.getByLabel('Nom affiché').fill('Sofia')
  await page.getByLabel('Rôle').selectOption('STAFF')
  await page.getByRole('button', { name: 'Enregistrer' }).click()

  await expect
    .poll(async () => e2eDb.salonMember.count({ where: { displayName: 'Sofia' } }))
    .toBe(1)

  // Créé sans compte : le rattachement viendra par invitation.
  const sofia = await e2eDb.salonMember.findFirstOrThrow({
    where: { displayName: 'Sofia' },
  })
  expect(sofia.userId).toBeNull()
})

test('la gérante modifie les règles de réservation', async ({ page }) => {
  await signIn(page, ownerId)
  await page.goto(`/pro/${salonId}/configuration/parametres`)

  await page.getByLabel('Délai minimum avant un rendez-vous (minutes)').fill('180')
  await page.getByLabel('Granularité des créneaux').selectOption('15')
  await page.getByRole('button', { name: 'Enregistrer les règles' }).click()

  await expect(page.getByRole('status')).toContainText('Règles enregistrées')

  const salon = await e2eDb.salon.findUniqueOrThrow({ where: { id: salonId } })
  expect(salon.bookingLeadTimeMin).toBe(180)
  expect(salon.slotStepMin).toBe(15)
})

test('des règles incohérentes sont refusées', async ({ page }) => {
  await signIn(page, ownerId)
  await page.goto(`/pro/${salonId}/configuration/parametres`)

  // Délai minimum de 10 jours pour un horizon de 2 jours : aucun créneau ne
  // serait jamais proposé.
  await page.getByLabel('Délai minimum avant un rendez-vous (minutes)').fill('14400')
  await page.getByLabel('Horizon de réservation (jours)').fill('2')
  await page.getByRole('button', { name: 'Enregistrer les règles' }).click()

  await expect(page.locator('p[role="alert"]')).toContainText(/aucun créneau/)
})

test('un client ne peut pas atteindre la configuration', async ({ page }) => {
  // 404 et non 403 : l'existence du salon ne doit pas être confirmée
  // (ADR-0002).
  await signIn(page, clientId)

  const response = await page.goto(`/pro/${salonId}/configuration`)

  expect(response?.status()).toBe(404)
})

test('une prestation créée devient réservable par un client', async ({ page }) => {
  // Chaîne complète : configuration → moteur de disponibilité → tunnel public.
  // C'est ce parcours qui valide le critère d'acceptation de la phase.
  await signIn(page, ownerId)
  await page.goto(`/pro/${salonId}/configuration`)

  await page.getByRole('button', { name: 'Ajouter une prestation' }).click()
  await page.getByLabel('Nom', { exact: true }).fill('Soin profond')
  await page.getByLabel('Durée (minutes)').fill('30')
  await page.getByLabel('Prix (€)').fill('38')
  await page.getByRole('button', { name: 'Enregistrer' }).click()
  await expect
    .poll(async () => e2eDb.service.count({ where: { name: 'Soin profond' } }))
    .toBe(1)

  // La prestation doit être affectée à un coiffeur pour être réservable.
  await page.goto(`/pro/${salonId}/configuration/equipe`)
  await page.getByRole('button', { name: 'Prestations' }).click()
  await page.getByRole('checkbox', { name: 'Soin profond' }).check()
  await page.getByRole('button', { name: 'Enregistrer' }).click()
  await expect.poll(async () => e2eDb.staffService.count()).toBe(2)

  // Côté client : la nouvelle prestation apparaît dans le tunnel.
  await signIn(page, clientId)
  await page.goto(`/reserver/${salonSlug}`)

  await expect(page.getByRole('checkbox', { name: /Soin profond/ })).toBeVisible()
})

test('les écrans de configuration n’ont aucune violation d’accessibilité', async ({
  page,
}) => {
  await signIn(page, ownerId)

  for (const path of ['', '/horaires', '/equipe', '/parametres']) {
    await page.goto(`/pro/${salonId}/configuration${path}`)
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa'])
      .analyze()

    expect(
      results.violations.map((v) => `${v.id}: ${v.description}`),
      `violations sur ${path || '/'}`,
    ).toEqual([])
  }
})

test('la gérante renomme une catégorie', async ({ page }) => {
  // `renameCategory` existait sans action serveur ni écran : on créait et
  // supprimait une catégorie, sans jamais pouvoir corriger son nom.
  await signIn(page, ownerId)
  const category = await e2eDb.serviceCategory.create({
    data: { salonId, name: 'Coupes', position: 0 },
  })

  await page.goto(`/pro/${salonId}/configuration`)
  await page.getByRole('button', { name: 'Renommer la catégorie Coupes' }).click()
  await page.getByLabel('Nouveau nom de la catégorie Coupes').fill('Coupe et coiffage')
  await page.getByRole('button', { name: 'Enregistrer' }).click()

  await expect
    .poll(async () => {
      const row = await e2eDb.serviceCategory.findUniqueOrThrow({
        where: { id: category.id },
      })
      return row.name
    })
    .toBe('Coupe et coiffage')
})

test('le journal du salon liste les actes de configuration', async ({ page }) => {
  // Le droit `audit:read_salon` existait, réservé au gérant, sans écran.
  await signIn(page, ownerId)
  const member = await e2eDb.salonMember.findFirstOrThrow({ where: { salonId } })
  await e2eDb.auditLog.create({
    data: {
      salonId,
      action: 'member.deactivated',
      targetType: 'SalonMember',
      targetId: member.id,
      metadata: {},
    },
  })

  await page.goto(`/pro/${salonId}/journal`)

  await expect(page.getByRole('heading', { name: 'Journal du salon' })).toBeVisible()
  await expect(page.getByText('Membre désactivé')).toBeVisible()
})
