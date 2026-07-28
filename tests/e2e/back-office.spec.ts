import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import { createSessionToken, e2eDb, seedE2e } from './helpers/seed'

/**
 * Statistiques et back-office plateforme.
 *
 * Vérifie surtout ce qui doit être **refusé** : un gérant ne doit pas atteindre
 * l'administration, ni exporter les données d'un salon voisin.
 */

let ownerId: string
let clientId: string
let salonId: string
let adminId: string

test.beforeEach(async () => {
  const { ownerUser, user, salon, member, service } = await seedE2e()
  ownerId = ownerUser.id
  clientId = user.id
  salonId = salon.id

  const admin = await e2eDb.user.create({
    data: {
      email: 'admin.e2e@example.fr',
      firstName: 'Alex',
      lastName: 'Admin',
      role: 'PLATFORM_ADMIN',
      emailVerified: new Date(),
    },
  })
  adminId = admin.id

  // Un rendez-vous honoré, pour que les statistiques ne soient pas vides.
  await e2eDb.appointment.create({
    data: {
      salonId: salon.id,
      memberId: member.id,
      guestName: 'Madame Durand',
      guestPhone: '+33600000000',
      startAt: new Date('2026-09-16T10:00:00+02:00'),
      endAt: new Date('2026-09-16T11:00:00+02:00'),
      status: 'DONE',
      items: {
        create: {
          salonId: salon.id,
          serviceId: service.id,
          nameSnapshot: 'Coupe femme',
          durationMin: 60,
          priceCents: 3500,
          position: 0,
        },
      },
    },
  })
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

const PERIOD = 'from=2026-09-01&to=2026-10-01'

test('la gérante consulte les statistiques de son salon', async ({ page }) => {
  await signIn(page, ownerId)
  await page.goto(`/pro/${salonId}/statistiques?${PERIOD}`)

  await expect(page.getByRole('heading', { name: 'Statistiques' })).toBeVisible()
  await expect(
    page.getByRole('term').filter({ hasText: 'Chiffre d’affaires' }),
  ).toBeVisible()
  await expect(page.getByText('35,00 €').first()).toBeVisible()
  await expect(page.getByText('Coupe femme').first()).toBeVisible()
})

test('la gérante exporte les rendez-vous en CSV', async ({ page }) => {
  await signIn(page, ownerId)

  const response = await page.request.get(`/api/salons/${salonId}/export?${PERIOD}`)

  expect(response.status()).toBe(200)
  expect(response.headers()['content-type']).toContain('text/csv')
  expect(response.headers()['content-disposition']).toContain('attachment')
  // Aucun cache : le fichier contient des données personnelles.
  expect(response.headers()['cache-control']).toContain('no-store')

  const csv = await response.text()
  expect(csv).toContain('Date;Début;Fin')
  expect(csv).toContain('Madame Durand')
  expect(csv).toContain('35,00')
})

test('l’export neutralise les formules d’un tableur', async ({ page }) => {
  // Un nom de client malveillant exécuterait sinon du code à l'ouverture du
  // fichier par le gérant.
  await e2eDb.appointment.updateMany({ data: { guestName: "=cmd|'/c calc'!A1" } })
  await signIn(page, ownerId)

  const response = await page.request.get(`/api/salons/${salonId}/export?${PERIOD}`)
  const csv = await response.text()

  expect(csv).toContain("'=cmd")
  expect(csv).not.toMatch(/;=cmd/)
})

test('un client ne peut pas exporter les données d’un salon', async ({ page }) => {
  // 404 et non 403 : l'existence de l'export ne doit pas être confirmée.
  await signIn(page, clientId)

  const response = await page.request.get(`/api/salons/${salonId}/export?${PERIOD}`)

  expect(response.status()).toBe(404)
})

test('un export sans période valide est refusé', async ({ page }) => {
  await signIn(page, ownerId)

  const response = await page.request.get(`/api/salons/${salonId}/export?from=nimporte`)

  expect(response.status()).toBe(400)
})

test('une gérante ne peut pas atteindre le back-office plateforme', async ({ page }) => {
  await signIn(page, ownerId)

  const response = await page.goto('/admin/salons')

  expect(response?.status()).toBe(404)
})

test('l’administrateur voit les indicateurs et la liste des salons', async ({ page }) => {
  await signIn(page, adminId)

  await page.goto('/admin')
  await expect(page.getByRole('heading', { name: 'Administration' })).toBeVisible()
  await expect(page.getByText('Salons').first()).toBeVisible()

  await page.goto('/admin/salons')
  await expect(page.getByText('Salon Bout-en-Bout')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Suspendre' })).toBeVisible()
})

test('l’administrateur crée un salon, inactif par défaut', async ({ page }) => {
  await signIn(page, adminId)
  await page.goto('/admin/salons')

  await page.getByRole('button', { name: 'Créer un salon' }).click()
  await page.getByLabel('Nom', { exact: true }).fill('Salon Neuf')
  await page.getByLabel('Adresse publique').fill('salon-neuf')
  await page.getByLabel('Adresse', { exact: true }).fill('5 rue Neuve')
  await page.getByLabel('Code postal').fill('75001')
  await page.getByLabel('Ville').fill('Paris')
  await page.getByLabel('Adresse du gérant').fill('gerante.e2e@example.fr')
  await page.getByLabel('Nom affiché du gérant').fill('Julie')
  await page.getByRole('button', { name: 'Créer', exact: true }).click()

  await expect
    .poll(async () => e2eDb.salon.count({ where: { slug: 'salon-neuf' } }))
    .toBe(1)

  const created = await e2eDb.salon.findFirstOrThrow({ where: { slug: 'salon-neuf' } })
  expect(created.isActive).toBe(false)
})

test('un salon suspendu disparaît de la recherche publique', async ({ page }) => {
  await signIn(page, adminId)
  await e2eDb.salon.update({ where: { id: salonId }, data: { isActive: false } })

  await page.goto('/')

  await expect(page.getByText('Aucun salon ne correspond')).toBeVisible()
})

test('le journal d’audit trace la suspension', async ({ page }) => {
  await signIn(page, adminId)
  await page.goto('/admin/salons')

  // La confirmation passe par une invite native.
  page.once('dialog', (dialog) => dialog.accept('Impayé'))
  await page.getByRole('button', { name: 'Suspendre' }).click()

  await expect.poll(async () => e2eDb.auditLog.count()).toBeGreaterThan(0)

  await page.goto('/admin/audit')
  await expect(page.getByText('salon.suspended')).toBeVisible()
})

test('les écrans d’administration n’ont aucune violation d’accessibilité', async ({
  page,
}) => {
  await signIn(page, adminId)

  for (const path of ['/admin', '/admin/salons', '/admin/comptes', '/admin/audit']) {
    await page.goto(path)
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa'])
      .analyze()

    expect(
      results.violations.map((v) => `${v.id}: ${v.description}`),
      `violations sur ${path}`,
    ).toEqual([])
  }
})
