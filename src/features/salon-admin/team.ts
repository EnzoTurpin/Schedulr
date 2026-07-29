import { invalidateSalon } from '@/features/availability'
import { assertCan } from '@/lib/authz/can'
import { ForbiddenError, ResourceNotFoundError, type Actor } from '@/lib/authz/types'
import { revokeAllSessions } from '@/lib/auth/session'
import { prisma } from '@/lib/db/client'
import { forSalon } from '@/lib/db/scoped'
import type { SalonRole } from '@/generated/prisma'
import { validateDayRanges, type WeekSchedule } from './schedule'

/**
 * Gestion de l'équipe : membres, rôles, horaires individuels, congés et
 * affectation des prestations.
 *
 * Un membre peut exister sans compte utilisateur (`userId` nul) : le salon
 * crée la fiche du coiffeur et son agenda immédiatement, le rattachement à un
 * compte viendra par invitation lorsque l'envoi de courriels sera livré.
 */

export async function listTeam(actor: Actor, salonId: string) {
  assertCan(actor, 'agenda:read_salon', { kind: 'salon', salonId })
  const db = forSalon(salonId)

  return db.salonMember.findMany({
    orderBy: [{ isActive: 'desc' }, { displayName: 'asc' }],
    select: {
      id: true,
      displayName: true,
      bio: true,
      color: true,
      role: true,
      isBookable: true,
      isActive: true,
      userId: true,
      user: { select: { email: true } },
      services: { select: { serviceId: true } },
      workingHours: {
        orderBy: [{ dayOfWeek: 'asc' }, { startMin: 'asc' }],
        select: { dayOfWeek: true, startMin: true, endMin: true },
      },
    },
  })
}

export type MemberInput = {
  displayName: string
  bio?: string | null
  color: string
  role: SalonRole
  isBookable: boolean
}

/**
 * Crée un membre et lui donne les horaires d'ouverture du salon.
 *
 * Le moteur de disponibilité croise les heures du salon avec celles du membre
 * **sans repli** : sans horaires propres, un coiffeur n'est jamais proposé à la
 * réservation. Laisser la fiche vide serait donc un piège — le gérant croirait
 * son équipe en place alors qu'aucun créneau n'existe.
 *
 * Ces horaires sont un point de départ visible et modifiable, pas une règle
 * implicite : ils apparaissent tels quels dans l'écran d'équipe.
 */
export async function createMember(actor: Actor, salonId: string, input: MemberInput) {
  assertCan(actor, 'member:manage', { kind: 'salon', salonId })

  const db = forSalon(salonId)

  const opening = await db.openingHour.findMany({
    select: { dayOfWeek: true, startMin: true, endMin: true },
  })

  const member = await db.salonMember.create({
    data: {
      salonId,
      ...input,
      bio: input.bio ?? null,
      workingHours: {
        create: opening.map((hour) => ({
          salonId,
          dayOfWeek: hour.dayOfWeek,
          startMin: hour.startMin,
          endMin: hour.endMin,
        })),
      },
    },
    select: { id: true, displayName: true },
  })

  invalidateSalon(salonId)
  return member
}

export async function updateMember(
  actor: Actor,
  salonId: string,
  memberId: string,
  input: MemberInput,
) {
  assertCan(actor, 'member:manage', { kind: 'salon', salonId })
  const db = forSalon(salonId)

  const existing = await db.salonMember.findUnique({
    where: { id: memberId },
    select: { id: true, role: true, userId: true },
  })
  if (!existing) throw new ResourceNotFoundError()

  // Un gérant ne peut pas se rétrograder lui-même : le salon se retrouverait
  // sans personne pour gérer l'équipe.
  if (
    existing.role === 'OWNER' &&
    input.role !== 'OWNER' &&
    existing.userId === actor.userId
  ) {
    throw new ForbiddenError('member:manage')
  }

  const member = await db.salonMember.update({
    where: { id: memberId },
    data: { ...input, bio: input.bio ?? null },
    select: { id: true, displayName: true, role: true },
  })

  invalidateSalon(salonId)
  return member
}

/**
 * Désactive un membre — il ne réapparaît plus dans la réservation ni dans les
 * colonnes d'agenda, mais ses rendez-vous passés lui restent rattachés.
 *
 * Si le membre a un compte, **toutes ses sessions sont révoquées** : c'est la
 * raison pour laquelle les sessions vivent en base (ADR-0001). Un employé qui
 * quitte le salon perd l'accès immédiatement, pas à l'expiration d'un jeton.
 */
export async function deactivateMember(actor: Actor, salonId: string, memberId: string) {
  assertCan(actor, 'member:manage', { kind: 'salon', salonId })
  const db = forSalon(salonId)

  const existing = await db.salonMember.findUnique({
    where: { id: memberId },
    select: { id: true, userId: true, role: true },
  })
  if (!existing) throw new ResourceNotFoundError()

  // Ne pas laisser un salon sans gérant actif.
  if (existing.role === 'OWNER') {
    const owners = await db.salonMember.count({
      where: { role: 'OWNER', isActive: true },
    })
    if (owners <= 1) {
      throw new ForbiddenError('member:manage')
    }
  }

  await db.salonMember.update({
    where: { id: memberId },
    data: { isActive: false, isBookable: false },
  })

  if (existing.userId) {
    await revokeAllSessions(existing.userId)
  }

  await prisma.auditLog.create({
    data: {
      salonId,
      actorId: actor.userId,
      action: 'member.deactivated',
      targetType: 'SalonMember',
      targetId: memberId,
      metadata: { hadAccount: existing.userId !== null },
    },
  })

  invalidateSalon(salonId)
}

/** Remplace en bloc les horaires de travail d'un membre. */
export async function replaceWorkingHours(
  actor: Actor,
  salonId: string,
  memberId: string,
  week: WeekSchedule,
) {
  assertCan(actor, 'schedule:manage_salon', { kind: 'salon', salonId })

  for (const ranges of Object.values(week)) {
    validateDayRanges(ranges)
  }

  const db = forSalon(salonId)
  const existing = await db.salonMember.findUnique({
    where: { id: memberId },
    select: { id: true },
  })
  if (!existing) throw new ResourceNotFoundError()

  const rows = Object.entries(week).flatMap(([day, ranges]) =>
    ranges.map((range) => ({
      salonId,
      memberId,
      dayOfWeek: Number(day),
      startMin: range.startMin,
      endMin: range.endMin,
    })),
  )

  await db.$transaction([
    db.workingHour.deleteMany({ where: { memberId } }),
    ...(rows.length > 0 ? [db.workingHour.createMany({ data: rows })] : []),
  ])

  invalidateSalon(salonId)
}

/**
 * Affecte à un membre l'ensemble exact des prestations qu'il réalise.
 *
 * Les surcharges de durée et de prix déjà saisies sont préservées pour les
 * prestations conservées : retirer puis remettre une prestation ne doit pas
 * effacer le tarif particulier d'un coiffeur.
 */
export async function setMemberServices(
  actor: Actor,
  salonId: string,
  memberId: string,
  serviceIds: string[],
) {
  assertCan(actor, 'service:manage', { kind: 'salon', salonId })
  const db = forSalon(salonId)

  const [member, services] = await Promise.all([
    db.salonMember.findUnique({ where: { id: memberId }, select: { id: true } }),
    db.service.findMany({
      where: { id: { in: serviceIds } },
      select: { id: true },
    }),
  ])

  if (!member) throw new ResourceNotFoundError()
  if (services.length !== new Set(serviceIds).size) {
    // Une prestation inconnue ou appartenant à un autre salon.
    throw new ResourceNotFoundError()
  }

  await db.$transaction([
    db.staffService.deleteMany({
      where: {
        memberId,
        serviceId: { notIn: serviceIds.length > 0 ? serviceIds : [''] },
      },
    }),
    ...serviceIds.map((serviceId) =>
      db.staffService.upsert({
        where: { memberId_serviceId: { memberId, serviceId } },
        create: { salonId, memberId, serviceId },
        update: {},
      }),
    ),
  ])

  invalidateSalon(salonId)
}

/** Surcharge la durée et le prix d'une prestation pour un coiffeur donné. */
export async function setServiceOverride(
  actor: Actor,
  salonId: string,
  memberId: string,
  serviceId: string,
  override: { durationMin: number | null; priceCents: number | null },
) {
  assertCan(actor, 'service:manage', { kind: 'salon', salonId })
  const db = forSalon(salonId)

  const existing = await db.staffService.findUnique({
    where: { memberId_serviceId: { memberId, serviceId } },
    select: { memberId: true },
  })
  if (!existing) throw new ResourceNotFoundError()

  await db.staffService.update({
    where: { memberId_serviceId: { memberId, serviceId } },
    data: override,
  })

  invalidateSalon(salonId)
}

export async function listTimeOff(actor: Actor, salonId: string, from = new Date()) {
  assertCan(actor, 'agenda:read_salon', { kind: 'salon', salonId })

  return forSalon(salonId).timeOff.findMany({
    where: { endAt: { gte: from } },
    orderBy: { startAt: 'asc' },
    select: {
      id: true,
      memberId: true,
      startAt: true,
      endAt: true,
      reason: true,
      member: { select: { displayName: true } },
    },
  })
}

/**
 * Pose un congé.
 *
 * Un coiffeur peut poser les siens ; il faut le droit `timeoff:manage_any` pour
 * ceux d'un collègue.
 */
export async function createTimeOff(
  actor: Actor,
  salonId: string,
  input: { memberId: string; startAt: Date; endAt: Date; reason?: string | null },
) {
  const db = forSalon(salonId)

  const member = await db.salonMember.findUnique({
    where: { id: input.memberId },
    select: { id: true },
  })
  if (!member) throw new ResourceNotFoundError()

  const own = actor.memberships.some(
    (membership) =>
      membership.salonId === salonId && membership.memberId === input.memberId,
  )
  assertCan(actor, own ? 'timeoff:manage_own' : 'timeoff:manage_any', {
    kind: 'salon',
    salonId,
  })

  if (input.endAt.getTime() <= input.startAt.getTime()) {
    throw new Error('La fin du congé doit suivre son début.')
  }

  const timeOff = await db.timeOff.create({
    data: { salonId, ...input, reason: input.reason ?? null },
    select: { id: true, startAt: true, endAt: true },
  })

  invalidateSalon(salonId)
  return timeOff
}

export async function deleteTimeOff(actor: Actor, salonId: string, timeOffId: string) {
  const db = forSalon(salonId)

  const existing = await db.timeOff.findUnique({
    where: { id: timeOffId },
    select: { id: true, memberId: true },
  })
  if (!existing) throw new ResourceNotFoundError()

  const own = actor.memberships.some(
    (membership) =>
      membership.salonId === salonId && membership.memberId === existing.memberId,
  )
  assertCan(actor, own ? 'timeoff:manage_own' : 'timeoff:manage_any', {
    kind: 'salon',
    salonId,
  })

  await db.timeOff.delete({ where: { id: timeOffId } })
  invalidateSalon(salonId)
}
