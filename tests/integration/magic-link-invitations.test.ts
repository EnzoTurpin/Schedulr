import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import {
  AlreadyLinkedError,
  EmailMismatchError,
  InvitationInvalidError,
  acceptInvitation,
  describeInvitation,
  inviteMember,
  listPendingInvitations,
  revokeInvitation,
} from '@/features/salon-admin/invitations'
import {
  consumeMagicLinkToken,
  createMagicLinkToken,
  purgeExpiredTokens,
} from '@/lib/auth/magicLink'
import { ForbiddenError, ResourceNotFoundError, type Actor } from '@/lib/authz/types'
import { resetDatabase, testDb } from './helpers/db'

/**
 * Liens de connexion et invitations d'équipe.
 *
 * Deux mécanismes proches — un jeton envoyé par courriel — mais aux garanties
 * distinctes : le lien de connexion vaut authentification et ne vit que
 * quinze minutes ; l'invitation ne donne accès qu'à une fiche précise, et
 * seulement au titulaire de l'adresse visée.
 */

async function fixture() {
  const salon = await testDb.salon.create({
    data: {
      slug: 'salon-invit',
      name: 'Salon Invitation',
      address: '1 rue des Tests',
      city: 'Lyon',
      postalCode: '69000',
      isActive: true,
    },
  })

  const ownerUser = await testDb.user.create({
    data: { email: 'gerante@example.fr', firstName: 'Julie', lastName: 'Roux' },
  })
  const ownerMember = await testDb.salonMember.create({
    data: {
      salonId: salon.id,
      userId: ownerUser.id,
      role: 'OWNER',
      displayName: 'Julie',
    },
  })

  // Coiffeuse sans compte : sa fiche existe, son agenda aussi.
  const pending = await testDb.salonMember.create({
    data: { salonId: salon.id, displayName: 'Sofia', role: 'STAFF' },
  })

  const owner: Actor = {
    userId: ownerUser.id,
    role: 'CLIENT',
    memberships: [
      { salonId: salon.id, memberId: ownerMember.id, role: 'OWNER', isActive: true },
    ],
  }

  return { salon, owner, ownerUser, ownerMember, pending }
}

/** Compte qui recevra l'invitation. */
async function invitee(email = 'sofia@example.fr'): Promise<Actor> {
  const user = await testDb.user.create({
    data: { email, firstName: 'Sofia', lastName: 'Nguyen' },
  })
  return { userId: user.id, role: 'CLIENT', memberships: [] }
}

describe('liens de connexion', () => {
  beforeEach(async () => {
    await resetDatabase()
    await testDb.verificationToken.deleteMany({})
  })

  afterAll(async () => {
    await testDb.$disconnect()
  })

  it('should return the email of a valid token', async () => {
    const token = await createMagicLinkToken('cliente@example.fr')

    expect(await consumeMagicLinkToken(token)).toBe('cliente@example.fr')
  })

  it('should normalise the email', async () => {
    const token = await createMagicLinkToken('  Cliente@Example.FR ')

    expect(await consumeMagicLinkToken(token)).toBe('cliente@example.fr')
  })

  it('should never store the raw token', async () => {
    // Une lecture de la table ne doit pas permettre de forger un lien.
    const token = await createMagicLinkToken('cliente@example.fr')

    const stored = await testDb.verificationToken.findFirstOrThrow()
    expect(stored.token).not.toBe(token)
    expect(stored.token).toHaveLength(64)
  })

  it('should be usable only once', async () => {
    const token = await createMagicLinkToken('cliente@example.fr')

    expect(await consumeMagicLinkToken(token)).toBe('cliente@example.fr')
    expect(await consumeMagicLinkToken(token)).toBeNull()
  })

  it('should reject an expired token and purge it', async () => {
    const token = await createMagicLinkToken('cliente@example.fr')
    await testDb.verificationToken.updateMany({
      data: { expires: new Date(Date.now() - 1000) },
    })

    expect(await consumeMagicLinkToken(token)).toBeNull()
    expect(await testDb.verificationToken.count()).toBe(0)
  })

  it('should reject an unknown token', async () => {
    expect(await consumeMagicLinkToken('inexistant')).toBeNull()
  })

  it('should reject an empty token', async () => {
    expect(await consumeMagicLinkToken('')).toBeNull()
  })

  it('should invalidate the previous link when a new one is requested', async () => {
    // Redemander un lien doit rendre le précédent inopérant.
    const first = await createMagicLinkToken('cliente@example.fr')
    const second = await createMagicLinkToken('cliente@example.fr')

    expect(await consumeMagicLinkToken(first)).toBeNull()
    expect(await consumeMagicLinkToken(second)).toBe('cliente@example.fr')
  })

  it('should let only one of two concurrent consumptions succeed', async () => {
    const token = await createMagicLinkToken('cliente@example.fr')

    const results = await Promise.all([
      consumeMagicLinkToken(token),
      consumeMagicLinkToken(token),
    ])

    // Le jeton vaut authentification : il ne doit ouvrir qu'une session.
    expect(results.filter(Boolean)).toHaveLength(1)
  })

  it('should purge expired tokens', async () => {
    await createMagicLinkToken('cliente@example.fr')
    await testDb.verificationToken.updateMany({
      data: { expires: new Date(Date.now() - 1000) },
    })

    expect(await purgeExpiredTokens()).toBe(1)
  })
})

describe('invitations d’équipe', () => {
  beforeEach(async () => {
    await resetDatabase()
  })

  it('should create an invitation for a member without an account', async () => {
    const { salon, owner, pending } = await fixture()

    const invitation = await inviteMember(owner, salon.id, pending.id, 'Sofia@Example.fr')

    expect(invitation.memberName).toBe('Sofia')
    expect(invitation.salonName).toBe('Salon Invitation')
    // L'adresse est normalisée.
    expect(invitation.email).toBe('sofia@example.fr')
    expect(invitation.token).toBeTruthy()
  })

  it('should never store the raw token', async () => {
    const { salon, owner, pending } = await fixture()

    const invitation = await inviteMember(owner, salon.id, pending.id, 'sofia@example.fr')

    const stored = await testDb.salonInvitation.findFirstOrThrow()
    expect(stored.tokenHash).not.toBe(invitation.token)
  })

  it('should refuse to invite a member who already has an account', async () => {
    const { salon, owner, ownerMember } = await fixture()

    await expect(
      inviteMember(owner, salon.id, ownerMember.id, 'autre@example.fr'),
    ).rejects.toThrow(AlreadyLinkedError)
  })

  it('should refuse an invitation from someone who is not the owner', async () => {
    const { salon, pending, ownerMember } = await fixture()
    const user = await testDb.user.create({
      data: { email: 'manager@example.fr', firstName: 'Marc', lastName: 'L' },
    })
    const manager: Actor = {
      userId: user.id,
      role: 'CLIENT',
      memberships: [
        { salonId: salon.id, memberId: ownerMember.id, role: 'MANAGER', isActive: true },
      ],
    }

    await expect(
      inviteMember(manager, salon.id, pending.id, 'sofia@example.fr'),
    ).rejects.toThrow(ForbiddenError)
  })

  it('should refuse a member of another salon', async () => {
    const a = await fixture()
    const other = await testDb.salon.create({
      data: {
        slug: 'autre',
        name: 'Autre',
        address: 'x',
        city: 'Lyon',
        postalCode: '69000',
      },
    })
    const foreign = await testDb.salonMember.create({
      data: { salonId: other.id, displayName: 'Ailleurs' },
    })

    await expect(
      inviteMember(a.owner, a.salon.id, foreign.id, 'sofia@example.fr'),
    ).rejects.toThrow(ResourceNotFoundError)
  })

  it('should replace the previous invitation when re-inviting', async () => {
    // Relancer doit invalider le lien envoyé précédemment.
    const { salon, owner, pending } = await fixture()
    const first = await inviteMember(owner, salon.id, pending.id, 'sofia@example.fr')
    const second = await inviteMember(owner, salon.id, pending.id, 'sofia@example.fr')

    expect(await describeInvitation(first.token)).toBeNull()
    expect(await describeInvitation(second.token)).not.toBeNull()
    expect(await testDb.salonInvitation.count()).toBe(1)
  })

  it('should record an audit entry without the email address', async () => {
    const { salon, owner, pending } = await fixture()

    await inviteMember(owner, salon.id, pending.id, 'sofia@example.fr')

    const log = await testDb.auditLog.findFirstOrThrow({
      where: { action: 'member.invited' },
    })
    expect(JSON.stringify(log.metadata)).not.toContain('@')
  })

  describe('acceptation', () => {
    it('should link the account to the member', async () => {
      const { salon, owner, pending } = await fixture()
      const invitation = await inviteMember(
        owner,
        salon.id,
        pending.id,
        'sofia@example.fr',
      )
      const sofia = await invitee()

      const salonId = await acceptInvitation(sofia, invitation.token)

      expect(salonId).toBe(salon.id)
      const linked = await testDb.salonMember.findUniqueOrThrow({
        where: { id: pending.id },
      })
      expect(linked.userId).toBe(sofia.userId)
    })

    it('should refuse an account with a different email', async () => {
      // Un lien transféré ne doit donner aucun accès.
      const { salon, owner, pending } = await fixture()
      const invitation = await inviteMember(
        owner,
        salon.id,
        pending.id,
        'sofia@example.fr',
      )
      const intruder = await invitee('intrus@example.fr')

      await expect(acceptInvitation(intruder, invitation.token)).rejects.toThrow(
        EmailMismatchError,
      )

      const untouched = await testDb.salonMember.findUniqueOrThrow({
        where: { id: pending.id },
      })
      expect(untouched.userId).toBeNull()
    })

    it('should be usable only once', async () => {
      const { salon, owner, pending } = await fixture()
      const invitation = await inviteMember(
        owner,
        salon.id,
        pending.id,
        'sofia@example.fr',
      )
      const sofia = await invitee()
      await acceptInvitation(sofia, invitation.token)

      await expect(acceptInvitation(sofia, invitation.token)).rejects.toThrow(
        InvitationInvalidError,
      )
    })

    it('should refuse an expired invitation', async () => {
      const { salon, owner, pending } = await fixture()
      const invitation = await inviteMember(
        owner,
        salon.id,
        pending.id,
        'sofia@example.fr',
      )
      await testDb.salonInvitation.updateMany({
        data: { expiresAt: new Date(Date.now() - 1000) },
      })
      const sofia = await invitee()

      await expect(acceptInvitation(sofia, invitation.token)).rejects.toThrow(/expiré/)
    })

    it('should refuse a revoked invitation', async () => {
      const { salon, owner, pending } = await fixture()
      const invitation = await inviteMember(
        owner,
        salon.id,
        pending.id,
        'sofia@example.fr',
      )
      await revokeInvitation(owner, salon.id, pending.id)
      const sofia = await invitee()

      await expect(acceptInvitation(sofia, invitation.token)).rejects.toThrow(
        InvitationInvalidError,
      )
    })

    it('should refuse an invitation whose post was deactivated', async () => {
      const { salon, owner, pending } = await fixture()
      const invitation = await inviteMember(
        owner,
        salon.id,
        pending.id,
        'sofia@example.fr',
      )
      await testDb.salonMember.update({
        where: { id: pending.id },
        data: { isActive: false },
      })
      const sofia = await invitee()

      await expect(acceptInvitation(sofia, invitation.token)).rejects.toThrow(
        /n’existe plus/,
      )
    })

    it('should give access to the salon agenda once accepted', async () => {
      const { salon, owner, pending } = await fixture()
      const invitation = await inviteMember(
        owner,
        salon.id,
        pending.id,
        'sofia@example.fr',
      )
      const sofia = await invitee()

      await acceptInvitation(sofia, invitation.token)

      // La session suivante verra l'appartenance : c'est ce que résout
      // `currentActor` à chaque requête.
      const member = await testDb.salonMember.findUniqueOrThrow({
        where: { id: pending.id },
        select: { userId: true, salonId: true, role: true },
      })
      expect(member).toMatchObject({
        userId: sofia.userId,
        salonId: salon.id,
        role: 'STAFF',
      })
    })
  })

  describe('liste', () => {
    it('should list pending invitations', async () => {
      const { salon, owner, pending } = await fixture()
      await inviteMember(owner, salon.id, pending.id, 'sofia@example.fr')

      const list = await listPendingInvitations(owner, salon.id)

      expect(list).toHaveLength(1)
      expect(list[0]?.member.displayName).toBe('Sofia')
    })

    it('should drop an accepted invitation from the list', async () => {
      const { salon, owner, pending } = await fixture()
      const invitation = await inviteMember(
        owner,
        salon.id,
        pending.id,
        'sofia@example.fr',
      )
      await acceptInvitation(await invitee(), invitation.token)

      expect(await listPendingInvitations(owner, salon.id)).toEqual([])
    })
  })
})
