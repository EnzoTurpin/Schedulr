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

test('la vue semaine est celle par défaut', async ({ page }) => {
  // C'est l'horizon sur lequel un salon raisonne : charge de la semaine, jours
  // creux, congés à venir.
  await signInAsOwner(page)
  await seedAppointment(14)

  await page.goto(`/pro/${salonId}?date=${DATE}`)

  await expect(
    page.getByRole('button', { name: 'Semaine', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true')
  await expect(
    page.getByRole('group', { name: /^(lun|mar|mer|jeu|ven|sam|dim)/ }),
  ).toHaveCount(7)
})

/** Ajoute un second coiffeur et lui pose un rendez-vous. */
async function seedColleague(hour: number) {
  const colleague = await e2eDb.salonMember.create({
    data: {
      salonId,
      displayName: 'Sofia',
      color: '#14b8a6',
      isBookable: true,
      services: { create: [{ salonId, serviceId }] },
    },
  })

  const startAt = new Date(`${DATE}T${String(hour).padStart(2, '0')}:00:00+02:00`)
  const appointment = await e2eDb.appointment.create({
    data: {
      salonId,
      memberId: colleague.id,
      guestName: 'Monsieur Colin',
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

  return { colleague, appointment }
}

test('la vue semaine réunit toute l’équipe dans les mêmes colonnes', async ({ page }) => {
  // Les colonnes sont des jours : deux coiffeurs cohabitent donc dans la même
  // journée, distingués par leur couleur.
  await signInAsOwner(page)
  await seedAppointment(14)
  await seedColleague(14)

  await page.goto(`/pro/${salonId}?date=${DATE}`)

  await expect(page.getByRole('button', { name: /Madame Durand/ })).toBeVisible()
  await expect(page.getByRole('button', { name: /Monsieur Colin/ })).toBeVisible()
  // Sept colonnes-jours, et non une par personne.
  await expect(
    page.getByRole('group', { name: /^(lun|mar|mer|jeu|ven|sam|dim)/ }),
  ).toHaveCount(7)
})

test('chaque rendez-vous porte la couleur de son coiffeur', async ({ page }) => {
  await signInAsOwner(page)
  await seedAppointment(14)
  await seedColleague(14)

  await page.goto(`/pro/${salonId}?date=${DATE}`)

  const first = page.getByRole('button', { name: /Madame Durand/ })
  const second = page.getByRole('button', { name: /Monsieur Colin/ })

  const colorOf = (block: typeof first) =>
    block.evaluate((node) => getComputedStyle(node).borderLeftColor)

  expect(await colorOf(first)).not.toBe(await colorOf(second))
})

test('décocher un coiffeur masque ses rendez-vous', async ({ page }) => {
  // Les pastilles se comportent comme des cases à cocher : toutes actives au
  // départ, un clic retire la personne de l'affichage.
  await signInAsOwner(page)
  await seedAppointment(14)
  await seedColleague(14)

  await page.goto(`/pro/${salonId}?date=${DATE}`)
  await page.getByRole('button', { name: 'Sofia' }).click()

  await expect(page.getByRole('button', { name: /Madame Durand/ })).toBeVisible()
  await expect(page.getByRole('button', { name: /Monsieur Colin/ })).toHaveCount(0)

  // La sélection vit dans l'URL : le lien est partageable et survit à un
  // rechargement.
  expect(new URL(page.url()).searchParams.get('membres')).toBe(memberId)
  await page.reload()
  await expect(page.getByRole('button', { name: /Monsieur Colin/ })).toHaveCount(0)
})

test('n’afficher qu’un coiffeur masque tous les autres', async ({ page }) => {
  await signInAsOwner(page)
  await seedAppointment(14)
  const { colleague } = await seedColleague(14)

  await page.goto(`/pro/${salonId}?date=${DATE}&membres=${colleague.id}`)

  await expect(page.getByRole('button', { name: /Monsieur Colin/ })).toBeVisible()
  await expect(page.getByRole('button', { name: /Madame Durand/ })).toHaveCount(0)
})

test('revenir à toute l’équipe réaffiche tout le monde', async ({ page }) => {
  await signInAsOwner(page)
  await seedAppointment(14)
  await seedColleague(14)

  await page.goto(`/pro/${salonId}?date=${DATE}`)
  await page.getByRole('button', { name: 'Sofia' }).click()
  await expect(page.getByRole('button', { name: /Monsieur Colin/ })).toHaveCount(0)

  await page.getByRole('button', { name: 'Toute l’équipe' }).click()

  await expect(page.getByRole('button', { name: /Madame Durand/ })).toBeVisible()
  await expect(page.getByRole('button', { name: /Monsieur Colin/ })).toBeVisible()
  // Le paramètre disparaît : « tous » est l'état par défaut, pas une sélection.
  expect(new URL(page.url()).searchParams.get('membres')).toBeNull()
})

test('la gérante voit l’agenda du jour avec ses rendez-vous', async ({ page }) => {
  await signInAsOwner(page)
  await seedAppointment(14)

  await page.goto(`/pro/${salonId}?date=${DATE}&view=day`)

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

  await page.goto(`/pro/${salonId}?date=${DATE}&view=day`)
  await page.getByRole('button', { name: /Madame Durand/ }).click()

  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  await expect(
    dialog.getByRole('definition').filter({ hasText: 'Coupe femme' }),
  ).toHaveCount(1)
  await expect(dialog.getByText('35,00 €')).toBeVisible()

  await dialog.getByRole('button', { name: 'Marquer honoré' }).click()

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

  await page.goto(`/pro/${salonId}?date=${DATE}&view=day`)
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

test('la fenêtre d’un rendez-vous s’ouvre centrée', async ({ page }) => {
  // Le navigateur centre une fenêtre modale par `margin: auto`, que le reset
  // de Tailwind écrase avec `margin: 0` : sans correctif, elle s'ancrait en
  // haut à gauche.
  await signInAsOwner(page)
  await seedAppointment(14)
  await page.setViewportSize({ width: 1280, height: 800 })

  await page.goto(`/pro/${salonId}?date=${DATE}&view=day`)
  await page.getByRole('button', { name: /Madame Durand/ }).click()

  const box = await page.getByRole('dialog').boundingBox()
  expect(box).not.toBeNull()
  // Une tolérance de deux pixels absorbe les arrondis de rendu.
  expect(Math.abs(box!.x + box!.width / 2 - 640)).toBeLessThanOrEqual(2)
  expect(Math.abs(box!.y + box!.height / 2 - 400)).toBeLessThanOrEqual(2)
})

test('la gérante déplace un rendez-vous depuis sa fenêtre', async ({ page }) => {
  // Le glisser-déposer a été retiré : décaler un rendez-vous d'un tremblement
  // de souris coûtait trop cher. Le déplacement est désormais un acte explicite.
  await signInAsOwner(page)
  const appointment = await seedAppointment(14)

  await page.goto(`/pro/${salonId}?date=${DATE}&view=day`)
  await page.getByRole('button', { name: /Madame Durand/ }).click()

  const dialog = page.getByRole('dialog')
  await dialog.getByRole('button', { name: 'Déplacer' }).click()
  await dialog.getByLabel('Début').fill(`${DATE}T16:30`)
  await dialog.getByRole('button', { name: 'Enregistrer' }).click()

  await expect
    .poll(async () => {
      const row = await e2eDb.appointment.findUniqueOrThrow({
        where: { id: appointment.id },
      })
      return row.startAt.toISOString()
    })
    .toBe(new Date(`${DATE}T16:30:00+02:00`).toISOString())
})

test('changer la durée depuis la fenêtre allonge le rendez-vous', async ({ page }) => {
  await signInAsOwner(page)
  const appointment = await seedAppointment(14)

  await page.goto(`/pro/${salonId}?date=${DATE}&view=day`)
  await page.getByRole('button', { name: /Madame Durand/ }).click()

  const dialog = page.getByRole('dialog')
  await dialog.getByRole('button', { name: 'Déplacer' }).click()
  await dialog.getByLabel('Durée').selectOption('90')
  await dialog.getByRole('button', { name: 'Enregistrer' }).click()

  await expect
    .poll(async () => {
      const row = await e2eDb.appointment.findUniqueOrThrow({
        where: { id: appointment.id },
      })
      return (row.endAt.getTime() - row.startAt.getTime()) / 60_000
    })
    .toBe(90)
})

test('la grille ne déplace plus rien au clavier', async ({ page }) => {
  // Souris et clavier sont désormais strictement équivalents : ni l'une ni
  // l'autre ne modifie depuis la grille.
  await signInAsOwner(page)
  const appointment = await seedAppointment(14)
  const before = appointment.startAt.toISOString()

  await page.goto(`/pro/${salonId}?date=${DATE}&view=day`)
  await page.getByRole('button', { name: /Madame Durand/ }).focus()
  await page.keyboard.press('ArrowDown')
  await page.waitForTimeout(300)

  const row = await e2eDb.appointment.findUniqueOrThrow({ where: { id: appointment.id } })
  expect(row.startAt.toISOString()).toBe(before)
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

  await page.goto(`/pro/${salonId}?date=${DATE}&view=day`)
  await page.getByRole('button', { name: /À déplacer/ }).click()

  const dialog = page.getByRole('dialog')
  await dialog.getByRole('button', { name: 'Déplacer' }).click()
  await dialog.getByLabel('Début').fill(`${DATE}T15:15`)
  await dialog.getByRole('button', { name: 'Enregistrer' }).click()

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

  const response = await page.goto(`/pro/${salonId}?date=${DATE}&view=day`)

  expect(response?.status()).toBe(404)
})

test('l’agenda n’a aucune violation d’accessibilité bloquante', async ({ page }) => {
  await signInAsOwner(page)
  await seedAppointment(14)
  await page.goto(`/pro/${salonId}?date=${DATE}&view=day`)

  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze()

  expect(results.violations.map((v) => `${v.id}: ${v.description}`)).toEqual([])
})

test('la gérante crée un rendez-vous au comptoir depuis une plage vide', async ({
  page,
}) => {
  await signInAsOwner(page)
  await page.goto(`/pro/${salonId}?date=${DATE}&view=day`)

  // Un clic sur le fond de la colonne ouvre le formulaire de création.
  await page
    .getByRole('group', { name: 'Camille' })
    .click({ position: { x: 50, y: 200 } })

  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  await dialog.getByRole('checkbox', { name: /Coupe femme/ }).check()
  await dialog.getByLabel('Nom du client').fill('Madame Nouvelle')
  await dialog.getByLabel(/Téléphone/).fill('+33611223344')
  await dialog.getByRole('button', { name: 'Créer le rendez-vous' }).click()

  await expect
    .poll(async () =>
      e2eDb.appointment.count({ where: { guestName: 'Madame Nouvelle' } }),
    )
    .toBe(1)

  const created = await e2eDb.appointment.findFirstOrThrow({
    where: { guestName: 'Madame Nouvelle' },
  })
  expect(created.clientId).toBeNull()
  expect(created.source).toBe('SALON')
  expect(created.guestPhone).toBe('+33611223344')
})

test('le formulaire de création se ferme avec Échap sans rien créer', async ({
  page,
}) => {
  await signInAsOwner(page)
  await page.goto(`/pro/${salonId}?date=${DATE}&view=day`)

  await page
    .getByRole('group', { name: 'Camille' })
    .click({ position: { x: 50, y: 200 } })
  await expect(page.getByRole('dialog')).toBeVisible()

  await page.keyboard.press('Escape')

  await expect(page.getByRole('dialog')).not.toBeVisible()
  expect(await e2eDb.appointment.count()).toBe(0)
})

test('la vue semaine affiche sept colonnes-jours', async ({ page }) => {
  await signInAsOwner(page)
  await seedAppointment(14)

  await page.goto(`/pro/${salonId}?date=${DATE}&view=week`)

  // `exact` : « Semaine » matcherait aussi « Semaine précédente » et
  // « Semaine suivante ».
  await expect(
    page.getByRole('button', { name: 'Semaine', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true')
  await expect(
    page.getByRole('group', { name: /^(lun|mar|mer|jeu|ven|sam|dim)/ }),
  ).toHaveCount(7)
  await expect(page.getByRole('button', { name: /Madame Durand/ })).toBeVisible()
})

test('la vue semaine se cale sur le lundi quelle que soit la date demandée', async ({
  page,
}) => {
  await signInAsOwner(page)
  // 2026-09-16 est un mercredi : la semaine doit démarrer le lundi 14.
  await page.goto(`/pro/${salonId}?date=${DATE}&view=week`)

  await expect(page.getByText(/Semaine du 14 septembre/)).toBeVisible()
})
