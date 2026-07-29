import { createHash, randomBytes } from 'node:crypto'
import { expect, test, type BrowserContext } from '@playwright/test'
import {
  CLIENT_EMAIL,
  CLIENT_PASSWORD,
  createSessionToken,
  e2eDb,
  seedE2e,
} from './helpers/seed'

/**
 * Invitation d'un membre à rejoindre l'équipe d'un salon.
 *
 * Le membre existe déjà en base — sa fiche, ses horaires et ses rendez-vous
 * sont créés bien avant qu'il ait un compte. L'invitation ne fait que
 * rattacher un compte à cette fiche.
 */

type Fixture = {
  token: string
  memberId: string
  salonId: string
  clientUserId: string
}

/**
 * Crée un poste vacant et l'invitation qui lui correspond.
 *
 * Le jeton est écrit directement en base : le passer par `inviteMember`
 * utiliserait le client Prisma global, branché sur une autre base que le
 * serveur sous test.
 */
async function seedInvitation(
  email: string,
  { expired = false }: { expired?: boolean } = {},
): Promise<Fixture> {
  const { salon, user, ownerUser } = await seedE2e()

  const member = await e2eDb.salonMember.create({
    data: {
      salonId: salon.id,
      displayName: 'Nouvelle Recrue',
      role: 'STAFF',
      isActive: true,
    },
  })

  const token = randomBytes(32).toString('base64url')
  await e2eDb.salonInvitation.create({
    data: {
      salonId: salon.id,
      memberId: member.id,
      email: email.toLowerCase(),
      tokenHash: createHash('sha256').update(token).digest('hex'),
      expiresAt: new Date(Date.now() + (expired ? -60_000 : 7 * 24 * 3_600_000)),
      invitedById: ownerUser.id,
    },
  })

  return {
    token,
    memberId: member.id,
    salonId: salon.id,
    clientUserId: user.id,
  }
}

async function signIn(context: BrowserContext, userId: string): Promise<void> {
  await context.addCookies([
    {
      name: 'schedulr.session',
      value: await createSessionToken(userId),
      url: 'http://127.0.0.1:3100',
    },
  ])
}

test.afterAll(async () => {
  await e2eDb.$disconnect()
})

test('le compte invité rejoint l’équipe et accède à l’agenda', async ({ page }) => {
  const { token, memberId, salonId, clientUserId } = await seedInvitation(CLIENT_EMAIL)
  await signIn(page.context(), clientUserId)

  await page.goto(`/invitation?jeton=${encodeURIComponent(token)}`)
  await expect(
    page.getByRole('heading', { name: /Rejoindre Salon Bout-en-Bout/ }),
  ).toBeVisible()

  await page.getByRole('button', { name: 'Accepter l’invitation' }).click()

  await expect(page).toHaveURL(new RegExp(`/pro/${salonId}`))

  const member = await e2eDb.salonMember.findUniqueOrThrow({ where: { id: memberId } })
  expect(member.userId).toBe(clientUserId)
})

test('une invitation adressée à quelqu’un d’autre n’est pas acceptable', async ({
  page,
}) => {
  // Le lien fonctionne, mais il désigne une autre adresse : le transférer ne
  // donne aucun accès.
  const { token, memberId, clientUserId } = await seedInvitation('autre@example.fr')
  await signIn(page.context(), clientUserId)

  await page.goto(`/invitation?jeton=${encodeURIComponent(token)}`)

  await expect(page.getByText('autre@example.fr')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Accepter l’invitation' })).toHaveCount(0)

  const member = await e2eDb.salonMember.findUniqueOrThrow({ where: { id: memberId } })
  expect(member.userId).toBeNull()
})

test('une invitation expirée est refusée', async ({ page }) => {
  const { token, clientUserId } = await seedInvitation(CLIENT_EMAIL, { expired: true })
  await signIn(page.context(), clientUserId)

  await page.goto(`/invitation?jeton=${encodeURIComponent(token)}`)

  await expect(page.getByRole('heading', { name: 'Invitation expirée' })).toBeVisible()
})

test('une invitation ne peut servir deux fois', async ({ page }) => {
  const { token, clientUserId, salonId } = await seedInvitation(CLIENT_EMAIL)
  await signIn(page.context(), clientUserId)

  await page.goto(`/invitation?jeton=${encodeURIComponent(token)}`)
  await page.getByRole('button', { name: 'Accepter l’invitation' }).click()
  await expect(page).toHaveURL(new RegExp(`/pro/${salonId}`))

  await page.goto(`/invitation?jeton=${encodeURIComponent(token)}`)

  await expect(page.getByRole('heading', { name: 'Invitation expirée' })).toBeVisible()
})

test('un visiteur non connecté retrouve son invitation après connexion', async ({
  page,
}) => {
  const { token, memberId, clientUserId, salonId } = await seedInvitation(CLIENT_EMAIL)

  await page.goto(`/invitation?jeton=${encodeURIComponent(token)}`)

  // Le jeton doit survivre au détour par la connexion : sans lui, la personne
  // n'aurait plus aucun moyen de retrouver l'invitation reçue par courriel.
  await expect(page).toHaveURL(/\/connexion\?suite=/)
  expect(decodeURIComponent(page.url())).toContain(`/invitation?jeton=${token}`)

  await page.getByLabel('Adresse électronique', { exact: true }).fill(CLIENT_EMAIL)
  await page.getByLabel('Mot de passe', { exact: true }).fill(CLIENT_PASSWORD)
  await page.getByRole('button', { name: 'Se connecter', exact: true }).click()

  await expect(
    page.getByRole('heading', { name: /Rejoindre Salon Bout-en-Bout/ }),
  ).toBeVisible()

  await page.getByRole('button', { name: 'Accepter l’invitation' }).click()
  await expect(page).toHaveURL(new RegExp(`/pro/${salonId}`))

  const member = await e2eDb.salonMember.findUniqueOrThrow({ where: { id: memberId } })
  expect(member.userId).toBe(clientUserId)
})
