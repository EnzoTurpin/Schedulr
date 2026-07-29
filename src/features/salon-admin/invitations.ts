import { createHash, randomBytes } from 'node:crypto'
import { assertCan } from '@/lib/authz/can'
import { normalizeEmail } from '@/lib/auth/magicLink'
import { ResourceNotFoundError, type Actor } from '@/lib/authz/types'
import { prisma } from '@/lib/db/client'
import { forSalon } from '@/lib/db/scoped'

/**
 * Invitations à rejoindre l'équipe d'un salon.
 *
 * Le membre existe déjà : le salon a créé sa fiche, ses horaires et son agenda
 * dès la phase 5. L'invitation ne fait que **rattacher un compte** à cette
 * fiche, pour que la personne accède à son agenda.
 *
 * Un compte peut donc être créé après coup sans perturber les rendez-vous déjà
 * planifiés — c'est ce que permettait le `userId` nullable posé en phase 1.
 */

/** Une semaine : assez pour être vue, assez court pour ne pas traîner. */
const LIFETIME_MS = 7 * 24 * 60 * 60 * 1000

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export class AlreadyLinkedError extends Error {
  constructor() {
    super('Ce membre est déjà rattaché à un compte.')
    this.name = 'AlreadyLinkedError'
  }
}

export class InvitationInvalidError extends Error {
  constructor(message = 'Cette invitation n’est plus valide.') {
    super(message)
    this.name = 'InvitationInvalidError'
  }
}

export class EmailMismatchError extends Error {
  constructor() {
    super(
      'Cette invitation a été envoyée à une autre adresse. Connectez-vous avec ' +
        'le compte correspondant.',
    )
    this.name = 'EmailMismatchError'
  }
}

export type InvitationCreated = {
  invitationId: string
  /** Jeton en clair, à insérer dans le lien du courriel. Jamais stocké. */
  token: string
  email: string
  memberName: string
  salonName: string
}

/**
 * Invite une personne à rattacher son compte à une fiche de membre.
 *
 * @throws {AlreadyLinkedError} le membre a déjà un compte.
 */
export async function inviteMember(
  actor: Actor,
  salonId: string,
  memberId: string,
  email: string,
): Promise<InvitationCreated> {
  assertCan(actor, 'member:manage', { kind: 'salon', salonId })

  const db = forSalon(salonId)

  const member = await db.salonMember.findUnique({
    where: { id: memberId },
    select: { id: true, userId: true, displayName: true, isActive: true },
  })

  if (!member || !member.isActive) throw new ResourceNotFoundError()
  if (member.userId) throw new AlreadyLinkedError()

  const salon = await prisma.salon.findUniqueOrThrow({
    where: { id: salonId },
    select: { name: true },
  })

  const token = randomBytes(32).toString('base64url')
  const normalized = normalizeEmail(email)

  // Une nouvelle invitation remplace la précédente : le membre n'en a qu'une à
  // la fois, et le lien envoyé plus tôt cesse d'être valable.
  const invitation = await prisma.salonInvitation.upsert({
    where: { memberId },
    create: {
      salonId,
      memberId,
      email: normalized,
      tokenHash: hashToken(token),
      expiresAt: new Date(Date.now() + LIFETIME_MS),
      invitedById: actor.userId,
    },
    update: {
      email: normalized,
      tokenHash: hashToken(token),
      expiresAt: new Date(Date.now() + LIFETIME_MS),
      invitedById: actor.userId,
      status: 'PENDING',
      acceptedAt: null,
    },
    select: { id: true },
  })

  await prisma.auditLog.create({
    data: {
      salonId,
      actorId: actor.userId,
      action: 'member.invited',
      targetType: 'SalonMember',
      targetId: memberId,
      // Aucune adresse : le journal ne porte pas de donnée personnelle.
      metadata: {},
    },
  })

  return {
    invitationId: invitation.id,
    token,
    email: normalized,
    memberName: member.displayName,
    salonName: salon.name,
  }
}

/** Détail d'une invitation, pour l'afficher avant acceptation. */
export async function describeInvitation(token: string) {
  const invitation = await prisma.salonInvitation.findUnique({
    where: { tokenHash: hashToken(token) },
    select: {
      id: true,
      email: true,
      status: true,
      expiresAt: true,
      member: { select: { displayName: true, role: true } },
      salon: { select: { name: true, city: true } },
    },
  })

  if (!invitation) return null
  if (invitation.status !== 'PENDING') return null
  if (invitation.expiresAt.getTime() <= Date.now()) return null

  return invitation
}

/**
 * Rattache le compte de l'appelant à la fiche de membre invitée.
 *
 * @throws {InvitationInvalidError} invitation inconnue, expirée ou déjà utilisée.
 * @throws {EmailMismatchError} l'appelant n'est pas la personne invitée.
 */
export async function acceptInvitation(actor: Actor, token: string): Promise<string> {
  const invitation = await prisma.salonInvitation.findUnique({
    where: { tokenHash: hashToken(token) },
    select: {
      id: true,
      salonId: true,
      memberId: true,
      email: true,
      status: true,
      expiresAt: true,
      member: { select: { userId: true, isActive: true } },
    },
  })

  if (!invitation || invitation.status !== 'PENDING') {
    throw new InvitationInvalidError()
  }
  if (invitation.expiresAt.getTime() <= Date.now()) {
    throw new InvitationInvalidError('Cette invitation a expiré.')
  }
  if (!invitation.member.isActive) {
    throw new InvitationInvalidError('Ce poste n’existe plus dans le salon.')
  }
  if (invitation.member.userId) {
    throw new InvitationInvalidError('Ce poste est déjà rattaché à un compte.')
  }

  const user = await prisma.user.findUniqueOrThrow({
    where: { id: actor.userId },
    select: { email: true },
  })

  // L'invitation vise une personne précise : un lien transféré ne doit pas
  // permettre à un tiers de s'introduire dans l'équipe.
  if (normalizeEmail(user.email) !== invitation.email) {
    throw new EmailMismatchError()
  }

  await prisma.$transaction([
    prisma.salonMember.update({
      where: { id: invitation.memberId },
      data: { userId: actor.userId },
    }),
    prisma.salonInvitation.update({
      where: { id: invitation.id },
      data: { status: 'ACCEPTED', acceptedAt: new Date() },
    }),
    prisma.auditLog.create({
      data: {
        salonId: invitation.salonId,
        actorId: actor.userId,
        action: 'member.invitation_accepted',
        targetType: 'SalonMember',
        targetId: invitation.memberId,
        metadata: {},
      },
    }),
  ])

  return invitation.salonId
}

/** Annule une invitation en attente. */
export async function revokeInvitation(
  actor: Actor,
  salonId: string,
  memberId: string,
): Promise<void> {
  assertCan(actor, 'member:manage', { kind: 'salon', salonId })

  const invitation = await prisma.salonInvitation.findFirst({
    where: { memberId, salonId, status: 'PENDING' },
    select: { id: true },
  })

  if (!invitation) throw new ResourceNotFoundError()

  await prisma.salonInvitation.update({
    where: { id: invitation.id },
    data: { status: 'REVOKED' },
  })
}

/** Invitations en attente d'un salon, pour l'écran d'équipe. */
export async function listPendingInvitations(actor: Actor, salonId: string) {
  assertCan(actor, 'member:manage', { kind: 'salon', salonId })

  return prisma.salonInvitation.findMany({
    where: { salonId, status: 'PENDING', expiresAt: { gt: new Date() } },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      memberId: true,
      email: true,
      expiresAt: true,
      member: { select: { displayName: true } },
    },
  })
}
