import { assertCan } from '@/lib/authz/can'
import type { Actor } from '@/lib/authz/types'
import { crossSalon } from '@/lib/db/scoped'
import { prisma } from '@/lib/db/client'

/**
 * Back-office plateforme.
 *
 * Lectures délibérément inter-salons : c'est le seul espace où cela est
 * légitime, et il est réservé à l'administrateur plateforme (ADR-0002).
 * Chaque fonction rejoue l'autorisation.
 *
 * Toutes les listes sont paginées — un catalogue de salons ou de comptes
 * grandit sans limite (CLAUDE.md).
 */

const PAGE_SIZE = 25

export type Page = { page?: number; q?: string }

/** Indicateurs globaux de la plateforme. */
export async function getPlatformStats(actor: Actor) {
  assertCan(actor, 'audit:read_platform', { kind: 'platform' })
  const db = crossSalon('indicateurs plateforme')

  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 3_600_000)

  const [
    salons,
    activeSalons,
    users,
    appointments,
    recentAppointments,
    failedNotifications,
  ] = await Promise.all([
    db.salon.count(),
    db.salon.count({ where: { isActive: true } }),
    // Les comptes anonymisés ne comptent plus : ils n'ont plus d'existence.
    db.user.count({ where: { deletedAt: null } }),
    db.appointment.count(),
    db.appointment.count({ where: { createdAt: { gte: thirtyDaysAgo } } }),
    db.notificationLog.count({ where: { status: 'FAILED', attempts: { gte: 3 } } }),
  ])

  return {
    salons,
    activeSalons,
    users,
    appointments,
    recentAppointments,
    failedNotifications,
  }
}

/** Salons de la plateforme, avec leur activité. */
export async function listSalons(actor: Actor, { page = 1, q }: Page = {}) {
  assertCan(actor, 'audit:read_platform', { kind: 'platform' })
  const db = crossSalon('liste des salons')

  const where = q
    ? {
        OR: [
          { name: { contains: q, mode: 'insensitive' as const } },
          { city: { contains: q, mode: 'insensitive' as const } },
          { slug: { contains: q, mode: 'insensitive' as const } },
        ],
      }
    : {}

  const [items, total] = await Promise.all([
    db.salon.findMany({
      where,
      orderBy: [{ isActive: 'desc' }, { createdAt: 'desc' }],
      take: PAGE_SIZE,
      skip: (page - 1) * PAGE_SIZE,
      select: {
        id: true,
        slug: true,
        name: true,
        city: true,
        isActive: true,
        createdAt: true,
        _count: { select: { members: true, appointments: true } },
      },
    }),
    db.salon.count({ where }),
  ])

  return { items, total, page, pageCount: Math.max(1, Math.ceil(total / PAGE_SIZE)) }
}

/**
 * Comptes de la plateforme.
 *
 * ⚠️ Cet écran expose des données personnelles. Il est réservé à
 * l'administrateur, et son usage est journalisé côté appelant.
 */
export async function listUsers(actor: Actor, { page = 1, q }: Page = {}) {
  assertCan(actor, 'audit:read_platform', { kind: 'platform' })

  const where = {
    deletedAt: null,
    ...(q
      ? {
          OR: [
            { email: { contains: q, mode: 'insensitive' as const } },
            { lastName: { contains: q, mode: 'insensitive' as const } },
          ],
        }
      : {}),
  }

  const [items, total] = await Promise.all([
    prisma.user.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: PAGE_SIZE,
      skip: (page - 1) * PAGE_SIZE,
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
        emailVerified: true,
        createdAt: true,
        _count: { select: { appointments: true, memberships: true } },
      },
    }),
    prisma.user.count({ where }),
  ])

  return { items, total, page, pageCount: Math.max(1, Math.ceil(total / PAGE_SIZE)) }
}

/** Journal d'audit de la plateforme, tous salons confondus. */
export async function listAuditLog(actor: Actor, { page = 1 }: Page = {}) {
  assertCan(actor, 'audit:read_platform', { kind: 'platform' })

  const [items, total] = await Promise.all([
    prisma.auditLog.findMany({
      orderBy: { createdAt: 'desc' },
      take: PAGE_SIZE,
      skip: (page - 1) * PAGE_SIZE,
      select: {
        id: true,
        action: true,
        targetType: true,
        targetId: true,
        metadata: true,
        createdAt: true,
        salon: { select: { name: true } },
        actor: { select: { email: true } },
      },
    }),
    prisma.auditLog.count(),
  ])

  return { items, total, page, pageCount: Math.max(1, Math.ceil(total / PAGE_SIZE)) }
}

/** Journal d'audit d'un seul salon, pour son gérant. */
export async function listSalonAuditLog(
  actor: Actor,
  salonId: string,
  { page = 1 }: Page = {},
) {
  assertCan(actor, 'audit:read_salon', { kind: 'salon', salonId })

  const [items, total] = await Promise.all([
    prisma.auditLog.findMany({
      where: { salonId },
      orderBy: { createdAt: 'desc' },
      take: PAGE_SIZE,
      skip: (page - 1) * PAGE_SIZE,
      select: {
        id: true,
        action: true,
        targetType: true,
        targetId: true,
        metadata: true,
        createdAt: true,
        actor: { select: { email: true } },
      },
    }),
    prisma.auditLog.count({ where: { salonId } }),
  ])

  return { items, total, page, pageCount: Math.max(1, Math.ceil(total / PAGE_SIZE)) }
}
