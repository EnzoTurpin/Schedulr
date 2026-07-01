import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import {
  createSession,
  resolveSession,
  revokeAllSessions,
  revokeSession,
} from '@/lib/auth/session'
import { createMember, createSalon, resetDatabase, testDb } from './helpers/db'

/**
 * Cycle de vie des sessions en base (ADR-0001).
 *
 * L'enjeu vérifié ici est la **révocation immédiate** : c'est la seule raison
 * pour laquelle nous avons renoncé aux sessions JWT et accepté un flux
 * d'authentification non standard.
 */

async function createUser(email = 'test@example.fr') {
  return testDb.user.create({
    data: { email, firstName: 'Test', lastName: 'Utilisateur' },
  })
}

describe('sessions en base', () => {
  beforeEach(async () => {
    await resetDatabase()
  })

  afterAll(async () => {
    await testDb.$disconnect()
  })

  it('should resolve a freshly created session', async () => {
    const user = await createUser()

    const token = await createSession(user.id)
    const session = await resolveSession(token)

    expect(session?.user.id).toBe(user.id)
  })

  it('should never store the raw token in database', async () => {
    // Une lecture de la table — sauvegarde, injection SQL, accès prestataire —
    // ne doit pas permettre d'usurper une session.
    const user = await createUser()

    const token = await createSession(user.id)

    const stored = await testDb.session.findFirstOrThrow()
    expect(stored.sessionToken).not.toBe(token)
    expect(stored.sessionToken).toHaveLength(64) // SHA-256 hexadécimal
  })

  it('should return null for an unknown token', async () => {
    await expect(resolveSession('jeton-inexistant')).resolves.toBeNull()
  })

  it('should return null when no token is provided', async () => {
    await expect(resolveSession(undefined)).resolves.toBeNull()
  })

  it('should return null and purge the row when the session has expired', async () => {
    const user = await createUser()
    const token = await createSession(user.id)

    await testDb.session.updateMany({ data: { expires: new Date(Date.now() - 1000) } })

    expect(await resolveSession(token)).toBeNull()
    expect(await testDb.session.count()).toBe(0)
  })

  it('should return null for an anonymised account', async () => {
    const user = await createUser()
    const token = await createSession(user.id)

    await testDb.user.update({
      where: { id: user.id },
      data: { deletedAt: new Date() },
    })

    expect(await resolveSession(token)).toBeNull()
  })

  it('should expose the active memberships of the account', async () => {
    const user = await createUser()
    const salon = await createSalon('salon-session')
    const member = await createMember(salon.id, 'Camille')
    await testDb.salonMember.update({
      where: { id: member.id },
      data: { userId: user.id, role: 'MANAGER' },
    })

    const token = await createSession(user.id)
    const session = await resolveSession(token)

    expect(session?.user.memberships).toHaveLength(1)
    expect(session?.user.memberships[0]?.role).toBe('MANAGER')
  })

  describe('révocation', () => {
    it('should invalidate a session immediately after revocation', async () => {
      const user = await createUser()
      const token = await createSession(user.id)

      await revokeSession(token)

      expect(await resolveSession(token)).toBeNull()
    })

    it('should not fail when revoking an already revoked session', async () => {
      const user = await createUser()
      const token = await createSession(user.id)
      await revokeSession(token)

      await expect(revokeSession(token)).resolves.toBeUndefined()
    })

    it('should invalidate every device when revoking all sessions', async () => {
      // Le scénario qui justifie l'ADR-0001 : un employé quitte le salon, son
      // accès doit tomber sur tous ses appareils, sans attendre l'expiration
      // d'un jeton.
      const user = await createUser()
      const phone = await createSession(user.id)
      const laptop = await createSession(user.id)

      const revoked = await revokeAllSessions(user.id)

      expect(revoked).toBe(2)
      expect(await resolveSession(phone)).toBeNull()
      expect(await resolveSession(laptop)).toBeNull()
    })

    it('should leave other accounts untouched when revoking all sessions', async () => {
      const alice = await createUser('alice@example.fr')
      const bob = await createUser('bob@example.fr')
      const aliceToken = await createSession(alice.id)
      const bobToken = await createSession(bob.id)

      await revokeAllSessions(alice.id)

      expect(await resolveSession(aliceToken)).toBeNull()
      expect(await resolveSession(bobToken)).not.toBeNull()
    })
  })
})
