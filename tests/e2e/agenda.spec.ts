import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import { createSessionToken, e2eDb, seedE2e } from './helpers/seed'

/**
 * Agenda professionnel — critère d'acceptation de la phase 4 : un gérant gère
 * une journée complète sans passer par la base.
 *
 * Vérifie aussi le retour visuel exigé par l'ADR-0004 : un déplacement refusé
 * doit remettre le rendez-vous à sa place, jamais laisser croire qu'il a
 * abouti.
 */

let ownerId: string
let salonId: string
let memberId: string
let serviceId: string

/** Date fixe des scénarios, hors changement d'heure. */
const DATE = '2026-09-16' // mercredi

test.beforeEach(async () => {
  const { ownerUser, salon, member, service } = await seedE2e()
  ownerId = ownerUser.id
  salonId = salon.id
  memberId = member.id
  serviceId = service.id
})

test.afterAll(async () => {
  await e2eDb.$disconnect()
})

async function signInAsOwner(page: Page) {
  const token = await createSessionToken(ownerId)
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

/** Crée un rendez-vous directement en base, pour préparer un scénario. */
async function seedAppointment(hour: number, guestName = 'Madame Durand') {
  const startAt = new Date(`${DATE}T${String(hour).padStart(2, '0')}:00:00+02:00`)
  return e2eDb.appointment.create({
    data: {
      salonId,
      memberId,
      guestName,
      startAt,
      endAt: new Date(startAt.getTime() + 60 * 60_000),
      source: 'PHONE',
      items: {
        create: {
          salonId,
          serviceId,
          nameSnapshot: 'Coupe femme',
          durationMin: 60,
          priceCents: 3500,
          position: 0,
        },
      },
    },
  })
}

test('la gérante voit l’agenda du jour avec ses rendez-vous', async ({ page }) => {
  await signInAsOwner(page)
  await seedAppointment(14)

  await page.goto(`/pro/${salonId}?date=${DATE}`)

  await expect(page.getByRole('heading', { name: 'Salon Bout-en-Bout' })).toBeVisible()
  await expect(page.getByRole('button', { name: /Madame Durand/ })).toBeVisible()
  // La colonne du coiffeur est bien présente.
  await expect(page.getByRole('heading', { name: 'Camille' })).toBeVisible()
})

test('la gérante ouvre le détail d’un rendez-vous et le marque honoré', async ({
  page,
}) => {
  await signInAsOwner(page)
  const appointment = await seedAppointment(14)

  await page.goto(`/pro/${salonId}?date=${DATE}`)
  await page.getByRole('button', { name: /Madame Durand/ }).click()

  const panel = page.getByRole('complementary', { name: 'Détail du rendez-vous' })
  await expect(panel).toBeVisible()
  await expect(panel.getByText('Coupe femme')).toBeVisible()
  await expect(panel.getByText('35,00 €')).toBeVisible()

  await panel.getByRole('button', { name: 'Marquer honoré' }).click()

  await expect
    .poll(async () => {
      const row = await e2eDb.appointment.findUniqueOrThrow({
        where: { id: appointment.id },
      })
      return row.status
    })
    .toBe('DONE')
})

test('la gérante marque un client absent, ce qui libère le créneau', async ({ page }) => {
  await signInAsOwner(page)
  const appointment = await seedAppointment(14)

  await page.goto(`/pro/${salonId}?date=${DATE}`)
  await page.getByRole('button', { name: /Madame Durand/ }).click()
  await page.getByRole('button', { name: 'Client absent' }).click()

  await expect
    .poll(async () => {
      const row = await e2eDb.appointment.findUniqueOrThrow({
        where: { id: appointment.id },
      })
      return row.status
    })
    .toBe('NO_SHOW')
})

test('un déplacement au clavier décale le rendez-vous', async ({ page }) => {
  // Exigence WCAG 2.1 AA : tout ce qui se fait à la souris doit se faire au
  // clavier — ici le glisser-déposer.
  await signInAsOwner(page)
  const appointment = await seedAppointment(14)
  const before = appointment.startAt.getTime()

  await page.goto(`/pro/${salonId}?date=${DATE}`)
  const block = page.getByRole('button', { name: /Madame Durand/ })
  await block.focus()
  await page.keyboard.press('ArrowDown')

  await expect
    .poll(async () => {
      const row = await e2eDb.appointment.findUniqueOrThrow({
        where: { id: appointment.id },
      })
      return row.startAt.getTime() - before
    })
    .toBe(15 * 60_000)
})

test('un déplacement refusé remet le rendez-vous à sa place', async ({ page }) => {
  // Le cœur de l'ADR-0004 côté interface : sans ce retour, la gérante croirait
  // son déplacement effectué alors que la base l'a rejeté.
  await signInAsOwner(page)
  const moved = await seedAppointment(14, 'À déplacer')
  // Un second rendez-vous colle au premier, sans le chevaucher : 14 h–15 h
  // puis 15 h–16 h. Descendre le premier de 15 min le ferait mordre sur le
  // second, et la contrainte refusera l'opération.
  await e2eDb.appointment.create({
    data: {
      salonId,
      memberId,
      guestName: 'Bloqueur',
      startAt: new Date(`${DATE}T15:00:00+02:00`),
      endAt: new Date(`${DATE}T16:00:00+02:00`),
      source: 'PHONE',
    },
  })

  await page.goto(`/pro/${salonId}?date=${DATE}`)
  await page.getByRole('button', { name: /À déplacer/ }).focus()
  await page.keyboard.press('ArrowDown')

  // Message explicite, et non un échec silencieux. On cible notre alerte :
  // Next.js injecte son propre role="alert" pour annoncer les changements de
  // route, qui reste vide.
  await expect(page.locator('p[role="alert"]')).toContainText(/chevauche/)

  // La base n'a pas bougé.
  const unchanged = await e2eDb.appointment.findUniqueOrThrow({ where: { id: moved.id } })
  expect(unchanged.startAt.toISOString()).toBe(
    new Date(`${DATE}T14:00:00+02:00`).toISOString(),
  )
})

test('un client ne peut pas atteindre l’agenda d’un salon', async ({ page }) => {
  // 404 et non 403 : l'existence du salon ne doit pas être confirmée
  // (ADR-0002).
  const { user } = await seedE2e()
  const token = await createSessionToken(user.id)
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

  const response = await page.goto(`/pro/${salonId}?date=${DATE}`)

  expect(response?.status()).toBe(404)
})

test('l’agenda n’a aucune violation d’accessibilité bloquante', async ({ page }) => {
  await signInAsOwner(page)
  await seedAppointment(14)
  await page.goto(`/pro/${salonId}?date=${DATE}`)

  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze()

  expect(results.violations.map((v) => `${v.id}: ${v.description}`)).toEqual([])
})
