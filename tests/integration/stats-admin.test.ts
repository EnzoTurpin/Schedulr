import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { clearCache } from '@/features/availability/cache'
import {
  listAuditLog,
  listSalonAuditLog,
  listSalons,
  listUsers,
  getPlatformStats,
} from '@/features/admin/queries'
import { SlugTakenError, createSalon, setSalonActive } from '@/features/admin/mutations'
import { getSalonStats, getStaffActivity, getTopServices } from '@/features/stats/salon'
import { ForbiddenError, ResourceNotFoundError, type Actor } from '@/lib/authz/types'
import { resetDatabase, testDb } from './helpers/db'

/**
 * Statistiques et back-office.
 *
 * Deux enjeux : le cloisonnement des chiffres — un gérant ne doit jamais voir
 * le chiffre d'affaires d'un concurrent — et la réserve du back-office à
 * l'administrateur plateforme.
 */

const PERIOD = {
  from: new Date('2026-09-01T00:00:00+02:00'),
  to: new Date('2026-10-01T00:00:00+02:00'),
}

async function fixture(slug = 'salon-stats') {
  const salon = await testDb.salon.create({
    data: {
      slug,
      name: `Salon ${slug}`,
      address: '1 rue des Tests',
      city: 'Lyon',
      postalCode: '69000',
      isActive: true,
    },
  })

  const service = await testDb.service.create({
    data: { salonId: salon.id, name: 'Coupe', durationMin: 60, priceCents: 3000 },
  })

  const ownerUser = await testDb.user.create({
    data: { email: `owner-${slug}@example.fr`, firstName: 'Julie', lastName: 'Roux' },
  })
  const member = await testDb.salonMember.create({
    data: {
      salonId: salon.id,
      userId: ownerUser.id,
      role: 'OWNER',
      displayName: 'Julie',
      workingHours: {
        // 8 h par jour, du lundi au vendredi.
        create: [1, 2, 3, 4, 5].map((dayOfWeek) => ({
          salonId: salon.id,
          dayOfWeek,
          startMin: 9 * 60,
          endMin: 17 * 60,
        })),
      },
    },
  })

  const owner: Actor = {
    userId: ownerUser.id,
    role: 'CLIENT',
    memberships: [
      { salonId: salon.id, memberId: member.id, role: 'OWNER', isActive: true },
    ],
  }

  const adminUser = await testDb.user.create({
    data: {
      email: `admin-${slug}@example.fr`,
      firstName: 'Alex',
      lastName: 'M',
      role: 'PLATFORM_ADMIN',
    },
  })
  const admin: Actor = {
    userId: adminUser.id,
    role: 'PLATFORM_ADMIN',
    memberships: [],
  }

  return { salon, service, member, owner, admin, ownerUser }
}

/** Crée un rendez-vous avec sa ligne de prestation. */
async function appointment(
  salonId: string,
  memberId: string,
  serviceId: string,
  hour: number,
  status: 'DONE' | 'NO_SHOW' | 'CANCELLED' | 'CONFIRMED' = 'DONE',
  priceCents = 3000,
) {
  const startAt = new Date(`2026-09-${String(hour).padStart(2, '0')}T10:00:00+02:00`)
  return testDb.appointment.create({
    data: {
      salonId,
      memberId,
      startAt,
      endAt: new Date(startAt.getTime() + 3_600_000),
      status,
      items: {
        create: {
          salonId,
          serviceId,
          nameSnapshot: 'Coupe',
          durationMin: 60,
          priceCents,
          position: 0,
        },
      },
    },
  })
}

describe('statistiques du salon', () => {
  beforeEach(async () => {
    await resetDatabase()
    clearCache()
  })

  afterAll(async () => {
    await testDb.$disconnect()
  })

  it('should count honoured appointments and their revenue', async () => {
    const { salon, service, member, owner } = await fixture()
    await appointment(salon.id, member.id, service.id, 10, 'DONE')
    await appointment(salon.id, member.id, service.id, 11, 'DONE')

    const stats = await getSalonStats(owner, salon.id, PERIOD)

    expect(stats.appointments).toBe(2)
    expect(stats.revenueCents).toBe(6000)
  })

  it('should separate expected revenue from realised revenue', async () => {
    // Un rendez-vous à venir n'est pas encaissé : le confondre gonflerait le
    // chiffre d'affaires.
    const { salon, service, member, owner } = await fixture()
    await appointment(salon.id, member.id, service.id, 10, 'DONE')
    await appointment(salon.id, member.id, service.id, 11, 'CONFIRMED')

    const stats = await getSalonStats(owner, salon.id, PERIOD)

    expect(stats.revenueCents).toBe(3000)
    expect(stats.expectedRevenueCents).toBe(3000)
  })

  it('should exclude cancelled appointments from the revenue', async () => {
    const { salon, service, member, owner } = await fixture()
    await appointment(salon.id, member.id, service.id, 10, 'CANCELLED')

    const stats = await getSalonStats(owner, salon.id, PERIOD)

    expect(stats.appointments).toBe(0)
    expect(stats.revenueCents).toBe(0)
    expect(stats.cancellations).toBe(1)
  })

  it('should compute the attendance rate on settled appointments only', async () => {
    const { salon, service, member, owner } = await fixture()
    await appointment(salon.id, member.id, service.id, 10, 'DONE')
    await appointment(salon.id, member.id, service.id, 11, 'DONE')
    await appointment(salon.id, member.id, service.id, 12, 'NO_SHOW')
    // Un rendez-vous à venir ne doit pas peser : il n'est ni honoré ni manqué.
    await appointment(salon.id, member.id, service.id, 13, 'CONFIRMED')

    const stats = await getSalonStats(owner, salon.id, PERIOD)

    expect(stats.noShows).toBe(1)
    expect(stats.attendanceRate).toBeCloseTo(2 / 3)
  })

  it('should return a null attendance rate without settled appointments', async () => {
    const { salon, owner } = await fixture()

    expect((await getSalonStats(owner, salon.id, PERIOD)).attendanceRate).toBeNull()
  })

  it('should compute an occupancy rate against the working hours', async () => {
    const { salon, service, member, owner } = await fixture()
    await appointment(salon.id, member.id, service.id, 10, 'DONE')

    const stats = await getSalonStats(owner, salon.id, PERIOD)

    // Une heure occupée sur ~176 h ouvrées en septembre : faible mais positif.
    expect(stats.occupancyRate).toBeGreaterThan(0)
    expect(stats.occupancyRate).toBeLessThan(0.05)
  })

  it('should keep the price frozen at booking time', async () => {
    // Changer un tarif ne doit pas réécrire le chiffre d'affaires passé.
    const { salon, service, member, owner } = await fixture()
    await appointment(salon.id, member.id, service.id, 10, 'DONE', 3000)
    await testDb.service.update({
      where: { id: service.id },
      data: { priceCents: 9900 },
    })

    expect((await getSalonStats(owner, salon.id, PERIOD)).revenueCents).toBe(3000)
  })

  it('should ignore appointments outside the period', async () => {
    const { salon, service, member, owner } = await fixture()
    await testDb.appointment.create({
      data: {
        salonId: salon.id,
        memberId: member.id,
        startAt: new Date('2026-08-15T10:00:00+02:00'),
        endAt: new Date('2026-08-15T11:00:00+02:00'),
        status: 'DONE',
        items: {
          create: {
            salonId: salon.id,
            serviceId: service.id,
            nameSnapshot: 'Coupe',
            durationMin: 60,
            priceCents: 3000,
            position: 0,
          },
        },
      },
    })

    expect((await getSalonStats(owner, salon.id, PERIOD)).appointments).toBe(0)
  })

  it('should not expose the figures of another salon', async () => {
    const a = await fixture('salon-a')
    const b = await fixture('salon-b')
    await appointment(b.salon.id, b.member.id, b.service.id, 10, 'DONE')

    expect((await getSalonStats(a.owner, a.salon.id, PERIOD)).revenueCents).toBe(0)
  })

  it('should refuse statistics to a staff member', async () => {
    const { salon, member } = await fixture()
    const user = await testDb.user.create({
      data: { email: 'staff@example.fr', firstName: 'Sofia', lastName: 'N' },
    })
    const staff: Actor = {
      userId: user.id,
      role: 'CLIENT',
      memberships: [
        { salonId: salon.id, memberId: member.id, role: 'STAFF', isActive: true },
      ],
    }

    await expect(getSalonStats(staff, salon.id, PERIOD)).rejects.toThrow(ForbiddenError)
  })

  describe('top des prestations', () => {
    it('should rank services by volume', async () => {
      const { salon, service, member, owner } = await fixture()
      const second = await testDb.service.create({
        data: { salonId: salon.id, name: 'Couleur', durationMin: 90, priceCents: 6000 },
      })
      await appointment(salon.id, member.id, service.id, 10, 'DONE')
      await appointment(salon.id, member.id, service.id, 11, 'DONE')
      await testDb.appointment.create({
        data: {
          salonId: salon.id,
          memberId: member.id,
          startAt: new Date('2026-09-12T10:00:00+02:00'),
          endAt: new Date('2026-09-12T11:30:00+02:00'),
          status: 'DONE',
          items: {
            create: {
              salonId: salon.id,
              serviceId: second.id,
              nameSnapshot: 'Couleur',
              durationMin: 90,
              priceCents: 6000,
              position: 0,
            },
          },
        },
      })

      const top = await getTopServices(owner, salon.id, PERIOD)

      expect(top[0]?.name).toBe('Coupe')
      expect(top[0]?.count).toBe(2)
      expect(top[1]?.name).toBe('Couleur')
    })
  })

  describe('activité par coiffeur', () => {
    it('should report each active member, even without appointments', async () => {
      const { salon, service, member, owner } = await fixture()
      await testDb.salonMember.create({
        data: { salonId: salon.id, displayName: 'Alex' },
      })
      await appointment(salon.id, member.id, service.id, 10, 'DONE')

      const activity = await getStaffActivity(owner, salon.id, PERIOD)

      expect(activity).toHaveLength(2)
      const alex = activity.find((a) => a.displayName === 'Alex')
      expect(alex?.appointments).toBe(0)
      const julie = activity.find((a) => a.displayName === 'Julie')
      expect(julie?.appointments).toBe(1)
      expect(julie?.revenueCents).toBe(3000)
    })
  })
})

describe('back-office plateforme', () => {
  beforeEach(async () => {
    await resetDatabase()
    clearCache()
  })

  describe('création de salon', () => {
    it('should create a salon inactive, with its owner', async () => {
      // Un salon naît inactif : l'administrateur l'active après vérification.
      const { admin, ownerUser } = await fixture()

      const salon = await createSalon(admin, {
        slug: 'nouveau-salon',
        name: 'Nouveau Salon',
        address: '2 rue Neuve',
        city: 'Paris',
        postalCode: '75001',
        ownerEmail: ownerUser.email,
        ownerDisplayName: 'Julie',
      })

      const created = await testDb.salon.findUniqueOrThrow({ where: { id: salon.id } })
      expect(created.isActive).toBe(false)

      const owner = await testDb.salonMember.findFirstOrThrow({
        where: { salonId: salon.id },
      })
      expect(owner.role).toBe('OWNER')
      expect(owner.userId).toBe(ownerUser.id)
    })

    it('should refuse a slug already taken', async () => {
      const { admin, ownerUser, salon } = await fixture()

      await expect(
        createSalon(admin, {
          slug: salon.slug,
          name: 'Doublon',
          address: 'x',
          city: 'Lyon',
          postalCode: '69000',
          ownerEmail: ownerUser.email,
          ownerDisplayName: 'Julie',
        }),
      ).rejects.toThrow(SlugTakenError)
    })

    it('should refuse an unknown owner account', async () => {
      const { admin } = await fixture()

      await expect(
        createSalon(admin, {
          slug: 'sans-gerant',
          name: 'Sans gérant',
          address: 'x',
          city: 'Lyon',
          postalCode: '69000',
          ownerEmail: 'inconnu@example.fr',
          ownerDisplayName: 'Personne',
        }),
      ).rejects.toThrow(ResourceNotFoundError)
    })

    it('should refuse creation to a salon owner', async () => {
      const { owner, ownerUser } = await fixture()

      await expect(
        createSalon(owner, {
          slug: 'usurpe',
          name: 'Usurpé',
          address: 'x',
          city: 'Lyon',
          postalCode: '69000',
          ownerEmail: ownerUser.email,
          ownerDisplayName: 'Julie',
        }),
      ).rejects.toThrow(ForbiddenError)
    })

    it('should record an audit entry', async () => {
      const { admin, ownerUser } = await fixture()

      await createSalon(admin, {
        slug: 'trace',
        name: 'Trace',
        address: 'x',
        city: 'Lyon',
        postalCode: '69000',
        ownerEmail: ownerUser.email,
        ownerDisplayName: 'Julie',
      })

      const log = await testDb.auditLog.findFirstOrThrow({
        where: { action: 'salon.created' },
      })
      // Aucune donnée personnelle : le slug est public.
      expect(JSON.stringify(log.metadata)).not.toContain('@')
    })
  })

  describe('suspension', () => {
    it('should suspend a salon and record the reason', async () => {
      const { admin, salon } = await fixture()

      await setSalonActive(admin, salon.id, false, 'Impayé')

      const updated = await testDb.salon.findUniqueOrThrow({ where: { id: salon.id } })
      expect(updated.isActive).toBe(false)

      const log = await testDb.auditLog.findFirstOrThrow({
        where: { action: 'salon.suspended' },
      })
      expect(log.metadata).toMatchObject({ reason: 'Impayé' })
    })

    it('should not cancel existing appointments', async () => {
      // Annuler serait une décision commerciale, pas technique.
      const { admin, salon, service, member } = await fixture()
      await appointment(salon.id, member.id, service.id, 10, 'CONFIRMED')

      await setSalonActive(admin, salon.id, false)

      expect(await testDb.appointment.count({ where: { status: 'CONFIRMED' } })).toBe(1)
    })

    it('should refuse suspension to a salon owner', async () => {
      const { owner, salon } = await fixture()

      await expect(setSalonActive(owner, salon.id, false)).rejects.toThrow(ForbiddenError)
    })
  })

  describe('listes', () => {
    it('should list salons with their activity', async () => {
      const { admin } = await fixture()

      const result = await listSalons(admin)

      expect(result.total).toBe(1)
      expect(result.items[0]?._count.members).toBe(1)
    })

    it('should filter salons by city', async () => {
      const { admin } = await fixture('salon-a')
      await testDb.salon.create({
        data: {
          slug: 'parisien',
          name: 'Parisien',
          address: 'x',
          city: 'Paris',
          postalCode: '75001',
        },
      })

      expect((await listSalons(admin, { q: 'paris' })).total).toBe(1)
    })

    it('should paginate the salon list', async () => {
      const { admin } = await fixture()
      for (let i = 0; i < 30; i++) {
        await testDb.salon.create({
          data: {
            slug: `salon-${i}`,
            name: `Salon ${i}`,
            address: 'x',
            city: 'Lyon',
            postalCode: '69000',
          },
        })
      }

      const first = await listSalons(admin, { page: 1 })

      expect(first.items).toHaveLength(25)
      expect(first.pageCount).toBe(2)
    })

    it('should exclude anonymised accounts from the user list', async () => {
      const { admin } = await fixture()
      await testDb.user.create({
        data: {
          email: 'efface@example.fr',
          firstName: 'Parti',
          lastName: 'P',
          deletedAt: new Date(),
        },
      })

      const users = await listUsers(admin)

      expect(users.items.some((u) => u.email === 'efface@example.fr')).toBe(false)
    })

    it('should refuse the user list to a salon owner', async () => {
      const { owner } = await fixture()

      await expect(listUsers(owner)).rejects.toThrow(ForbiddenError)
    })

    it('should list the platform audit log', async () => {
      const { admin, salon } = await fixture()
      await setSalonActive(admin, salon.id, false)

      const log = await listAuditLog(admin)

      expect(log.total).toBeGreaterThan(0)
      expect(log.items[0]?.action).toBe('salon.suspended')
    })

    it('should limit the salon audit log to that salon', async () => {
      const a = await fixture('salon-a')
      const b = await fixture('salon-b')
      await setSalonActive(a.admin, a.salon.id, false)
      await setSalonActive(b.admin, b.salon.id, false)

      const log = await listSalonAuditLog(a.owner, a.salon.id)

      expect(log.total).toBe(1)
    })

    it('should refuse the salon audit log to a manager', async () => {
      // Le journal d'audit est réservé au gérant (plan d'action, §2).
      const { salon, member } = await fixture()
      const user = await testDb.user.create({
        data: { email: 'manager@example.fr', firstName: 'Marc', lastName: 'L' },
      })
      const manager: Actor = {
        userId: user.id,
        role: 'CLIENT',
        memberships: [
          { salonId: salon.id, memberId: member.id, role: 'MANAGER', isActive: true },
        ],
      }

      await expect(listSalonAuditLog(manager, salon.id)).rejects.toThrow(ForbiddenError)
    })
  })

  describe('indicateurs globaux', () => {
    it('should count salons, accounts and appointments', async () => {
      const { admin, salon, service, member } = await fixture()
      await appointment(salon.id, member.id, service.id, 10, 'DONE')

      const stats = await getPlatformStats(admin)

      expect(stats.salons).toBe(1)
      expect(stats.activeSalons).toBe(1)
      expect(stats.appointments).toBe(1)
      expect(stats.users).toBeGreaterThanOrEqual(2)
    })

    it('should refuse platform statistics to a salon owner', async () => {
      const { owner } = await fixture()

      await expect(getPlatformStats(owner)).rejects.toThrow(ForbiddenError)
    })
  })
})
