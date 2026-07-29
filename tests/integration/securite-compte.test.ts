import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import {
  changePassword,
  countActiveSessions,
  InvalidPasswordError,
  signOutEverywhere,
} from '@/features/account/security'
import { confirmEmail, createVerificationToken } from '@/lib/auth/emailVerification'
import { consumeMagicLinkToken, createMagicLinkToken } from '@/lib/auth/magicLink'
import { hashPassword, verifyPassword } from '@/lib/auth/password'
import { createSession, resolveSession } from '@/lib/auth/session'
import type { Actor } from '@/lib/authz/types'
import { resetDatabase, testDb } from './helpers/db'

/**
 * Sécurité du compte : vérification d'adresse, mot de passe, sessions.
 *
 * Un compte compromis n'avait aucun recours avant ce lot, et n'importe qui
 * pouvait s'inscrire avec l'adresse d'un tiers.
 */

const PASSWORD = 'mot-de-passe-initial-2026'

async function fixture(email = 'titulaire@example.fr') {
  const user = await testDb.user.create({
    data: {
      email,
      firstName: 'Camille',
      lastName: 'Titulaire',
      passwordHash: await hashPassword(PASSWORD),
    },
  })

  const actor: Actor = { userId: user.id, role: 'CLIENT', memberships: [] }
  return { user, actor }
}

describe('sécurité du compte', () => {
  beforeEach(async () => {
    await resetDatabase()
  })

  afterAll(async () => {
    await testDb.$disconnect()
  })

  describe('vérification d’adresse', () => {
    it('should mark the address as verified when the token is consumed', async () => {
      const { user } = await fixture()

      const token = await createVerificationToken(user.email)
      expect(await confirmEmail(token)).toBe(user.email)

      const updated = await testDb.user.findUniqueOrThrow({ where: { id: user.id } })
      expect(updated.emailVerified).not.toBeNull()
    })

    it('should refuse a token that was already consumed', async () => {
      const { user } = await fixture()
      const token = await createVerificationToken(user.email)

      await confirmEmail(token)

      expect(await confirmEmail(token)).toBeNull()
    })

    it('should refuse an expired token', async () => {
      const { user } = await fixture()
      const token = await createVerificationToken(user.email)

      await testDb.verificationToken.updateMany({
        where: { identifier: user.email },
        data: { expires: new Date(Date.now() - 1000) },
      })

      expect(await confirmEmail(token)).toBeNull()
      const updated = await testDb.user.findUniqueOrThrow({ where: { id: user.id } })
      expect(updated.emailVerified).toBeNull()
    })

    it('should refuse a verification token used as a login link', async () => {
      // Les deux vivent dans la même table : sans usage explicite, un lien de
      // confirmation ouvrirait une session, ce pour quoi il n'a pas été émis.
      const { user } = await fixture()
      const token = await createVerificationToken(user.email)

      expect(await consumeMagicLinkToken(token)).toBeNull()
    })

    it('should refuse a login token used as a verification link', async () => {
      const { user } = await fixture()
      const token = await createMagicLinkToken(user.email)

      expect(await confirmEmail(token)).toBeNull()
    })

    it('should keep a pending verification when a login link is requested', async () => {
      // Demander un lien de connexion invalide les liens de connexion
      // antérieurs, pas une vérification d'adresse en cours.
      const { user } = await fixture()
      const verification = await createVerificationToken(user.email)

      await createMagicLinkToken(user.email)

      expect(await confirmEmail(verification)).toBe(user.email)
    })
  })

  describe('changement de mot de passe', () => {
    it('should replace the hash when the current password matches', async () => {
      const { user, actor } = await fixture()

      await changePassword(actor, {
        currentPassword: PASSWORD,
        newPassword: 'nouveau-mot-de-passe-2026',
      })

      const updated = await testDb.user.findUniqueOrThrow({ where: { id: user.id } })
      expect(
        await verifyPassword(updated.passwordHash!, 'nouveau-mot-de-passe-2026'),
      ).toBe(true)
    })

    it('should reject a wrong current password', async () => {
      const { actor } = await fixture()

      await expect(
        changePassword(actor, {
          currentPassword: 'ce-n-est-pas-le-bon',
          newPassword: 'nouveau-mot-de-passe-2026',
        }),
      ).rejects.toThrow(InvalidPasswordError)
    })

    it('should close every session when the password changes', async () => {
      // Le point essentiel : changer son mot de passe après une compromission
      // ne sert à rien si la session de l'intrus reste ouverte.
      const { user, actor } = await fixture()
      const intruder = await createSession(user.id)
      await createSession(user.id)

      await changePassword(actor, {
        currentPassword: PASSWORD,
        newPassword: 'nouveau-mot-de-passe-2026',
      })

      expect(await resolveSession(intruder)).toBeNull()
      expect(await countActiveSessions(actor)).toBe(0)
    })

    it('should reject a change on an account that has no password', async () => {
      // Compte créé par lien magique : aucun mot de passe à confirmer.
      const user = await testDb.user.create({
        data: { email: 'sans-mot-de-passe@example.fr' },
      })
      const actor: Actor = { userId: user.id, role: 'CLIENT', memberships: [] }

      await expect(
        changePassword(actor, {
          currentPassword: 'peu-importe',
          newPassword: 'nouveau-mot-de-passe-2026',
        }),
      ).rejects.toThrow(InvalidPasswordError)
    })
  })

  describe('sessions', () => {
    it('should close every session of the account when asked', async () => {
      const { user, actor } = await fixture()
      await createSession(user.id)
      await createSession(user.id)

      expect(await signOutEverywhere(actor)).toBe(2)
      expect(await countActiveSessions(actor)).toBe(0)
    })

    it('should leave other accounts untouched', async () => {
      const { user, actor } = await fixture()
      const other = await fixture('autre@example.fr')
      await createSession(user.id)
      const otherToken = await createSession(other.user.id)

      await signOutEverywhere(actor)

      expect(await resolveSession(otherToken)).not.toBeNull()
    })

    it('should not count an expired session as active', async () => {
      const { user, actor } = await fixture()
      await createSession(user.id)
      await testDb.session.updateMany({
        where: { userId: user.id },
        data: { expires: new Date(Date.now() - 1000) },
      })

      expect(await countActiveSessions(actor)).toBe(0)
    })
  })
})
