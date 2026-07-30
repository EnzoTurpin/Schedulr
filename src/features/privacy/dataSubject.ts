import { createHash, randomUUID } from 'node:crypto'
import { prisma } from '@/lib/db/client'
import { purgeExpiredTokens } from '@/lib/auth/magicLink'
import { revokeAllSessions } from '@/lib/auth/session'
import type { Actor } from '@/lib/authz/types'

/**
 * Droits des personnes (RGPD).
 *
 * Deux droits sont ouverts au client depuis son espace : l'accès — sous forme
 * d'un export complet — et l'effacement.
 *
 * L'effacement est une **anonymisation**, pas une suppression : les
 * rendez-vous passés restent nécessaires au salon pour sa comptabilité et sa
 * responsabilité. C'est prévu par le RGPD, à condition que la personne ne soit
 * plus identifiable, ce que garantit l'écrasement des champs ci-dessous.
 */

export type PersonalDataExport = {
  exportedAt: string
  account: {
    email: string
    firstName: string | null
    lastName: string | null
    phone: string | null
    createdAt: string
  }
  consents: { type: string; granted: boolean; source: string; recordedAt: string }[]
  /**
   * Invitations reçues à rejoindre l'équipe d'un salon. Elles portent l'adresse
   * de la personne, elles lui sont donc communicables.
   */
  invitations: { salon: string; status: string; invitedAt: string }[]
  appointments: {
    salon: string
    startAt: string
    status: string
    services: string[]
    totalCents: number
    clientNote: string | null
  }[]
  /**
   * Les notifications sont listées sans leur contenu ni leur destinataire : le
   * journal ne stocke qu'une empreinte, et la restituer n'apporterait rien à la
   * personne.
   */
  notifications: {
    channel: string
    template: string
    status: string
    sentAt: string | null
  }[]
}

/**
 * Export de toutes les données rattachées à une personne.
 *
 * ⚠️ Les notes internes du salon (`staffNote`) sont volontairement exclues :
 * elles appartiennent au salon, pas au client, et peuvent contenir des
 * appréciations professionnelles. Le droit d'accès porte sur les données de la
 * personne, pas sur l'ensemble des documents qui la mentionnent.
 */
export async function exportPersonalData(actor: Actor): Promise<PersonalDataExport> {
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: actor.userId },
    select: {
      email: true,
      firstName: true,
      lastName: true,
      phone: true,
      createdAt: true,
      consents: {
        orderBy: { createdAt: 'desc' },
        select: { type: true, granted: true, source: true, createdAt: true },
      },
      appointments: {
        orderBy: { startAt: 'desc' },
        select: {
          startAt: true,
          status: true,
          clientNote: true,
          salon: { select: { name: true } },
          items: { select: { nameSnapshot: true, priceCents: true } },
          notifications: {
            select: { channel: true, template: true, status: true, sentAt: true },
          },
        },
      },
    },
  })

  // Les invitations ne sont pas rattachées au compte mais à l'adresse : une
  // invitation précède, par construction, le rattachement d'un compte à la
  // fiche de membre.
  const invitations = await prisma.salonInvitation.findMany({
    where: { email: user.email },
    orderBy: { createdAt: 'desc' },
    select: { status: true, createdAt: true, salon: { select: { name: true } } },
  })

  return {
    exportedAt: new Date().toISOString(),
    account: {
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      phone: user.phone,
      createdAt: user.createdAt.toISOString(),
    },
    consents: user.consents.map((consent) => ({
      type: consent.type,
      granted: consent.granted,
      source: consent.source,
      recordedAt: consent.createdAt.toISOString(),
    })),
    invitations: invitations.map((invitation) => ({
      salon: invitation.salon.name,
      status: invitation.status,
      invitedAt: invitation.createdAt.toISOString(),
    })),
    appointments: user.appointments.map((appointment) => ({
      salon: appointment.salon.name,
      startAt: appointment.startAt.toISOString(),
      status: appointment.status,
      services: appointment.items.map((item) => item.nameSnapshot),
      totalCents: appointment.items.reduce((sum, item) => sum + item.priceCents, 0),
      clientNote: appointment.clientNote,
    })),
    notifications: user.appointments.flatMap((appointment) =>
      appointment.notifications.map((notification) => ({
        channel: notification.channel,
        template: notification.template,
        status: notification.status,
        sentAt: notification.sentAt?.toISOString() ?? null,
      })),
    ),
  }
}

export class ActiveMembershipError extends Error {
  constructor() {
    super(
      'Vous êtes membre d’un salon. Demandez au gérant de vous retirer de ' +
        'l’équipe avant de supprimer votre compte.',
    )
    this.name = 'ActiveMembershipError'
  }
}

/**
 * Adresse d'un compte anonymisé.
 *
 * Elle doit rester unique — la colonne l'exige — sans permettre de retrouver
 * l'originale. Une empreinte tronquée y suffit : elle n'est pas réversible et
 * ne collisionne pas en pratique.
 */
function anonymousEmail(userId: string): string {
  const digest = createHash('sha256').update(userId).digest('hex').slice(0, 16)
  return `anonyme-${digest}@supprime.invalid`
}

/**
 * Efface un compte par anonymisation.
 *
 * Ce qui disparaît : identité, contacts, mot de passe, sessions, consentements,
 * et les notes que la personne avait laissées aux salons.
 *
 * Ce qui subsiste : les rendez-vous, détachés de toute identité. Un salon doit
 * pouvoir justifier son activité passée ; le client n'y est plus identifiable.
 *
 * @throws {ActiveMembershipError} si la personne travaille encore dans un salon.
 */
export async function eraseAccount(actor: Actor): Promise<void> {
  const memberships = await prisma.salonMember.count({
    where: { userId: actor.userId, isActive: true },
  })

  // Anonymiser un gérant laisserait son salon sans responsable identifiable.
  if (memberships > 0) {
    throw new ActiveMembershipError()
  }

  const now = new Date()

  // L'adresse actuelle sert à retrouver les invitations, qui ne sont pas liées
  // au compte : il faut la lire avant de l'anonymiser.
  const { email } = await prisma.user.findUniqueOrThrow({
    where: { id: actor.userId },
    select: { email: true },
  })

  await prisma.$transaction([
    prisma.user.update({
      where: { id: actor.userId },
      data: {
        email: anonymousEmail(actor.userId),
        firstName: null,
        lastName: null,
        phone: null,
        name: null,
        image: null,
        passwordHash: null,
        emailVerified: null,
        deletedAt: now,
      },
    }),
    // Les notes du client mentionnent parfois des éléments personnels.
    prisma.appointment.updateMany({
      where: { clientId: actor.userId },
      data: { clientNote: null },
    }),
    // Le registre des consentements n'a plus d'objet sans personne à protéger.
    prisma.consentRecord.deleteMany({ where: { userId: actor.userId } }),
    prisma.account.deleteMany({ where: { userId: actor.userId } }),
    prisma.session.deleteMany({ where: { userId: actor.userId } }),
    // L'adresse est neutralisée, pas l'invitation : le salon doit garder trace
    // d'avoir invité quelqu'un, sans conserver de quoi le recontacter.
    prisma.salonInvitation.updateMany({
      where: { email },
      data: { email: anonymousEmail(actor.userId), tokenHash: randomUUID() },
    }),
  ])

  await revokeAllSessions(actor.userId)
}

/**
 * Durées de conservation.
 *
 * Le RGPD interdit de garder des données personnelles indéfiniment. Ces durées
 * sont un choix produit, à valider avec le responsable de traitement — elles
 * figurent dans la politique de confidentialité.
 */
export const RETENTION = {
  /** Rendez-vous : trois ans, alignés sur la prescription commerciale. */
  appointmentYears: 3,
  /** Journal des envois : un an, suffisant pour traiter une réclamation. */
  notificationMonths: 12,
  /** Journal d'audit : trois ans, comme les rendez-vous. */
  auditYears: 3,
  /** Comptes anonymisés sans rendez-vous : purgés au bout d'un an. */
  anonymisedAccountMonths: 12,
  /**
   * Invitations expirées ou révoquées : trois mois.
   *
   * Elles portent une adresse en clair. Le délai laisse le temps de constater
   * qu'une invitation n'a pas abouti, sans conserver indéfiniment de quoi
   * recontacter quelqu'un qui n'a jamais rejoint l'équipe.
   */
  expiredInvitationMonths: 3,
} as const

export type PurgeReport = {
  appointments: number
  notifications: number
  auditEntries: number
  accounts: number
  /** Liens de connexion périmés. */
  tokens: number
  /** Sessions expirées jamais reprises. */
  sessions: number
  /** Invitations expirées ou révoquées, qui portaient une adresse en clair. */
  invitations: number
}

/**
 * Purge les données au-delà de leur durée de conservation.
 *
 * Exécutée par un job planifié. Idempotente par construction : elle ne
 * supprime que ce qui dépasse le seuil, un second passage ne trouve plus rien.
 */
export async function purgeExpiredData(now = new Date()): Promise<PurgeReport> {
  const monthsAgo = (months: number) =>
    new Date(now.getTime() - months * 30 * 24 * 3_600_000)
  const yearsAgo = (years: number) => monthsAgo(years * 12)

  // Les lignes de prestation partent en cascade avec leur rendez-vous.
  const appointments = await prisma.appointment.deleteMany({
    where: { startAt: { lt: yearsAgo(RETENTION.appointmentYears) } },
  })

  const notifications = await prisma.notificationLog.deleteMany({
    where: { createdAt: { lt: monthsAgo(RETENTION.notificationMonths) } },
  })

  const auditEntries = await prisma.auditLog.deleteMany({
    where: { createdAt: { lt: yearsAgo(RETENTION.auditYears) } },
  })

  // Un compte anonymisé qui n'a plus aucun rendez-vous n'a plus de raison
  // d'exister : sa ligne ne sert plus qu'à occuper de la place.
  const accounts = await prisma.user.deleteMany({
    where: {
      deletedAt: { lt: monthsAgo(RETENTION.anonymisedAccountMonths) },
      appointments: { none: {} },
    },
  })

  // Les liens de connexion expirés ne servent plus à rien et s'accumulent.
  const tokens = await purgeExpiredTokens(now)

  // Les sessions expirées sont supprimées à la lecture, mais celles d'un compte
  // qui ne revient jamais restaient indéfiniment — chacune portant un `userId`.
  const sessions = await prisma.session.deleteMany({ where: { expires: { lt: now } } })

  // Les invitations expirées portent une adresse en clair : les conserver
  // au-delà de leur validité n'a aucune utilité.
  const invitations = await prisma.salonInvitation.deleteMany({
    where: {
      status: { in: ['PENDING', 'REVOKED'] },
      expiresAt: { lt: monthsAgo(RETENTION.expiredInvitationMonths) },
    },
  })

  return {
    appointments: appointments.count,
    notifications: notifications.count,
    auditEntries: auditEntries.count,
    accounts: accounts.count,
    tokens,
    sessions: sessions.count,
    invitations: invitations.count,
  }
}
