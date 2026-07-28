import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { clearCache } from '@/features/availability/cache'
import {
  createWalkIn,
  moveAppointment,
  resizeAppointment,
  setAppointmentStatus,
  setStaffNote,
} from '@/features/agenda/mutations'
import { getClientRecord, listAgenda, listAgendaStaff } from '@/features/agenda/queries'
import { ForbiddenError, ResourceNotFoundError, type Actor } from '@/lib/authz/types'
import { SlotConflictError } from '@/lib/db/errors'
import { resetDatabase, testDb } from './helpers/db'

/**
 * Agenda professionnel.
 *
 * L'enjeu spécifique de ces tests : le salon dispose de droits plus larges que
 * le client — il crée hors créneaux, déplace, requalifie — mais reste soumis à
 * la contrainte d'exclusion et au cloisonnement par salon.
 */

const h = (hours: number) => hours * 60
const DAY = new Date('2026-07-15T00:00:00+02:00')
const DAY_END = new Date('2026-07-16T00:00:00+02:00')
const slot = (hour: number) =>
  new Date(`2026-07-15T${String(hour).padStart(2, '0')}:00:00+02:00`)

async function fixture() {
  const salon = await testDb.salon.create({
    data: {
      slug: 'salon-agenda',
      name: 'Salon Agenda',
      address: '1 rue des Tests',
      city: 'Lyon',
      postalCode: '69000',
      isActive: true,
      openingHours: { create: [{ dayOfWeek: 3, startMin: h(9), endMin: h(19) }] },
    },
  })

  const service = await testDb.service.create({
    data: { salonId: salon.id, name: 'Coupe', durationMin: 60, priceCents: 3000 },
  })

  const camille = await testDb.salonMember.create({
    data: { salonId: salon.id, displayName: 'Camille', color: '#8b5cf6' },
  })
  const alex = await testDb.salonMember.create({
    data: { salonId: salon.id, displayName: 'Alex', color: '#ec4899' },
  })

  const ownerUser = await testDb.user.create({
    data: { email: 'gerante@example.fr', firstName: 'Julie', lastName: 'Roux' },
  })
  const staffUser = await testDb.user.create({
    data: { email: 'coiffeuse@example.fr', firstName: 'Camille', lastName: 'B' },
  })

  const owner: Actor = {
    userId: ownerUser.id,
    role: 'CLIENT',
    memberships: [
      { salonId: salon.id, memberId: camille.id, role: 'OWNER', isActive: true },
    ],
  }
  const staff: Actor = {
    userId: staffUser.id,
    role: 'CLIENT',
    memberships: [
      { salonId: salon.id, memberId: camille.id, role: 'STAFF', isActive: true },
    ],
  }

  return { salon, service, camille, alex, owner, staff }
}

describe('agenda professionnel', () => {
  beforeEach(async () => {
    await resetDatabase()
    clearCache()
  })

  afterAll(async () => {
    await testDb.$disconnect()
  })

  describe('rendez-vous au comptoir', () => {
    it('should create an appointment for a client without an account', async () => {
      const { salon, service, camille, owner } = await fixture()

      const result = await createWalkIn(owner, {
        salonId: salon.id,
        memberId: camille.id,
        serviceIds: [service.id],
        startAt: slot(14),
        guestName: 'Madame Durand',
        guestPhone: '+33600000000',
        source: 'PHONE',
      })

      expect(result.id).toBeDefined()
      const created = await testDb.appointment.findUniqueOrThrow({
        where: { id: result.id },
      })
      expect(created.clientId).toBeNull()
      expect(created.guestName).toBe('Madame Durand')
      expect(created.source).toBe('PHONE')
    })

    it('should compute the end time from the service duration', async () => {
      const { salon, service, camille, owner } = await fixture()

      const result = await createWalkIn(owner, {
        salonId: salon.id,
        memberId: camille.id,
        serviceIds: [service.id],
        startAt: slot(14),
        guestName: 'Client',
        source: 'SALON',
      })

      expect((result.endAt.getTime() - result.startAt.getTime()) / 60_000).toBe(60)
    })

    it('should allow booking outside the public opening hours', async () => {
      // Un client qui pousse la porte à 20 h ne doit pas être refusé par le
      // logiciel : le salon décide, pas la règle de réservation en ligne.
      const { salon, service, camille, owner } = await fixture()

      await expect(
        createWalkIn(owner, {
          salonId: salon.id,
          memberId: camille.id,
          serviceIds: [service.id],
          startAt: slot(20),
          guestName: 'Tardif',
          source: 'SALON',
        }),
      ).resolves.toBeDefined()
    })

    it('should still refuse to overlap an existing appointment', async () => {
      const { salon, service, camille, owner } = await fixture()
      await createWalkIn(owner, {
        salonId: salon.id,
        memberId: camille.id,
        serviceIds: [service.id],
        startAt: slot(14),
        guestName: 'Premier',
        source: 'SALON',
      })

      await expect(
        createWalkIn(owner, {
          salonId: salon.id,
          memberId: camille.id,
          serviceIds: [service.id],
          startAt: new Date('2026-07-15T14:30:00+02:00'),
          guestName: 'Second',
          source: 'SALON',
        }),
      ).rejects.toThrow(SlotConflictError)
    })

    it('should refuse a service from another salon', async () => {
      const { salon, camille, owner } = await fixture()
      const other = await testDb.salon.create({
        data: {
          slug: 'autre',
          name: 'Autre',
          address: 'x',
          city: 'Lyon',
          postalCode: '69000',
        },
      })
      const foreign = await testDb.service.create({
        data: { salonId: other.id, name: 'Coupe', durationMin: 30, priceCents: 2000 },
      })

      await expect(
        createWalkIn(owner, {
          salonId: salon.id,
          memberId: camille.id,
          serviceIds: [foreign.id],
          startAt: slot(14),
          guestName: 'Client',
          source: 'SALON',
        }),
      ).rejects.toThrow(ResourceNotFoundError)
    })

    it('should refuse a staff member who lacks the write permission', async () => {
      const { salon, service, camille, staff } = await fixture()

      await expect(
        createWalkIn(staff, {
          salonId: salon.id,
          memberId: camille.id,
          serviceIds: [service.id],
          startAt: slot(14),
          guestName: 'Client',
          source: 'SALON',
        }),
      ).rejects.toThrow(ForbiddenError)
    })
  })

  describe('déplacement', () => {
    async function booked() {
      const base = await fixture()
      const appointment = await createWalkIn(base.owner, {
        salonId: base.salon.id,
        memberId: base.camille.id,
        serviceIds: [base.service.id],
        startAt: slot(14),
        guestName: 'Client',
        source: 'SALON',
      })
      return { ...base, appointmentId: appointment.id }
    }

    it('should move an appointment while preserving its duration', async () => {
      const { salon, appointmentId, owner } = await booked()

      const moved = await moveAppointment(owner, {
        salonId: salon.id,
        appointmentId,
        startAt: slot(16),
      })

      expect(moved.startAt.toISOString()).toBe(slot(16).toISOString())
      expect((moved.endAt.getTime() - moved.startAt.getTime()) / 60_000).toBe(60)
    })

    it('should move an appointment to another hairdresser', async () => {
      const { salon, appointmentId, alex, owner } = await booked()

      const moved = await moveAppointment(owner, {
        salonId: salon.id,
        appointmentId,
        startAt: slot(14),
        memberId: alex.id,
      })

      expect(moved.memberId).toBe(alex.id)
    })

    it('should refuse a move colliding with another appointment', async () => {
      const { salon, service, camille, appointmentId, owner } = await booked()
      await createWalkIn(owner, {
        salonId: salon.id,
        memberId: camille.id,
        serviceIds: [service.id],
        startAt: slot(16),
        guestName: 'Autre',
        source: 'SALON',
      })

      await expect(
        moveAppointment(owner, { salonId: salon.id, appointmentId, startAt: slot(16) }),
      ).rejects.toThrow(SlotConflictError)
    })

    it('should leave the appointment untouched when the move is refused', async () => {
      // L'interface remet le bloc à sa place : encore faut-il que la base n'ait
      // pas bougé (ADR-0004).
      const { salon, service, camille, appointmentId, owner } = await booked()
      await createWalkIn(owner, {
        salonId: salon.id,
        memberId: camille.id,
        serviceIds: [service.id],
        startAt: slot(16),
        guestName: 'Autre',
        source: 'SALON',
      })

      await expect(
        moveAppointment(owner, { salonId: salon.id, appointmentId, startAt: slot(16) }),
      ).rejects.toThrow()

      const unchanged = await testDb.appointment.findUniqueOrThrow({
        where: { id: appointmentId },
      })
      expect(unchanged.startAt.toISOString()).toBe(slot(14).toISOString())
    })

    it('should report an appointment of another salon as not found', async () => {
      const { appointmentId, owner } = await booked()
      const other = await testDb.salon.create({
        data: {
          slug: 'autre',
          name: 'Autre',
          address: 'x',
          city: 'Lyon',
          postalCode: '69000',
        },
      })

      await expect(
        moveAppointment(owner, {
          salonId: other.id,
          appointmentId,
          startAt: slot(16),
        }),
      ).rejects.toThrow(ResourceNotFoundError)
    })
  })

  describe('redimensionnement', () => {
    it('should extend an appointment', async () => {
      const { salon, service, camille, owner } = await fixture()
      const appointment = await createWalkIn(owner, {
        salonId: salon.id,
        memberId: camille.id,
        serviceIds: [service.id],
        startAt: slot(14),
        guestName: 'Client',
        source: 'SALON',
      })

      const resized = await resizeAppointment(owner, {
        salonId: salon.id,
        appointmentId: appointment.id,
        endAt: slot(16),
      })

      expect((resized.endAt.getTime() - resized.startAt.getTime()) / 60_000).toBe(120)
    })

    it('should refuse an end before the start', async () => {
      const { salon, service, camille, owner } = await fixture()
      const appointment = await createWalkIn(owner, {
        salonId: salon.id,
        memberId: camille.id,
        serviceIds: [service.id],
        startAt: slot(14),
        guestName: 'Client',
        source: 'SALON',
      })

      await expect(
        resizeAppointment(owner, {
          salonId: salon.id,
          appointmentId: appointment.id,
          endAt: slot(13),
        }),
      ).rejects.toThrow(/doit suivre son début/)
    })
  })

  describe('statuts', () => {
    async function booked() {
      const base = await fixture()
      const appointment = await createWalkIn(base.owner, {
        salonId: base.salon.id,
        memberId: base.camille.id,
        serviceIds: [base.service.id],
        startAt: slot(14),
        guestName: 'Client',
        source: 'SALON',
      })
      return { ...base, appointmentId: appointment.id }
    }

    it('should mark an appointment as done', async () => {
      const { salon, appointmentId, owner } = await booked()

      const updated = await setAppointmentStatus(owner, {
        salonId: salon.id,
        appointmentId,
        status: 'DONE',
      })

      expect(updated.status).toBe('DONE')
    })

    it('should mark a client as a no-show and free the slot', async () => {
      const { salon, service, camille, appointmentId, owner } = await booked()

      await setAppointmentStatus(owner, {
        salonId: salon.id,
        appointmentId,
        status: 'NO_SHOW',
      })

      // Le créneau est de nouveau réservable.
      await expect(
        createWalkIn(owner, {
          salonId: salon.id,
          memberId: camille.id,
          serviceIds: [service.id],
          startAt: slot(14),
          guestName: 'Remplaçant',
          source: 'SALON',
        }),
      ).resolves.toBeDefined()
    })

    it('should record an audit entry with the status transition', async () => {
      const { salon, appointmentId, owner } = await booked()

      await setAppointmentStatus(owner, {
        salonId: salon.id,
        appointmentId,
        status: 'DONE',
      })

      const log = await testDb.auditLog.findFirstOrThrow({
        where: { action: 'appointment.status.done' },
      })
      expect(log.metadata).toEqual({ from: 'CONFIRMED', to: 'DONE' })
    })

    it('should let a staff member update their own appointment', async () => {
      const { salon, appointmentId, staff } = await booked()

      await expect(
        setAppointmentStatus(staff, {
          salonId: salon.id,
          appointmentId,
          status: 'DONE',
        }),
      ).resolves.toBeDefined()
    })

    it('should refuse a staff member updating a colleague’s appointment', async () => {
      const { salon, service, alex, owner, staff } = await fixture()
      const colleagues = await createWalkIn(owner, {
        salonId: salon.id,
        memberId: alex.id,
        serviceIds: [service.id],
        startAt: slot(14),
        guestName: 'Client',
        source: 'SALON',
      })

      await expect(
        setAppointmentStatus(staff, {
          salonId: salon.id,
          appointmentId: colleagues.id,
          status: 'DONE',
        }),
      ).rejects.toThrow(ForbiddenError)
    })

    it('should refuse a status that is not settable from the agenda', async () => {
      const { salon, appointmentId, owner } = await booked()

      await expect(
        setAppointmentStatus(owner, {
          salonId: salon.id,
          appointmentId,
          status: 'PENDING',
        }),
      ).rejects.toThrow(/non modifiable/)
    })
  })

  describe('lecture', () => {
    it('should list appointments overlapping the window', async () => {
      const { salon, service, camille, owner } = await fixture()
      await createWalkIn(owner, {
        salonId: salon.id,
        memberId: camille.id,
        serviceIds: [service.id],
        startAt: slot(14),
        guestName: 'Client',
        source: 'SALON',
      })

      const agenda = await listAgenda(salon.id, DAY, DAY_END)

      expect(agenda).toHaveLength(1)
      expect(agenda[0]?.clientName).toBe('Client')
      expect(agenda[0]?.services).toEqual(['Coupe'])
      expect(agenda[0]?.totalPriceCents).toBe(3000)
    })

    it('should exclude cancelled appointments from the agenda', async () => {
      const { salon, service, camille, owner } = await fixture()
      const appointment = await createWalkIn(owner, {
        salonId: salon.id,
        memberId: camille.id,
        serviceIds: [service.id],
        startAt: slot(14),
        guestName: 'Client',
        source: 'SALON',
      })
      await setAppointmentStatus(owner, {
        salonId: salon.id,
        appointmentId: appointment.id,
        status: 'CANCELLED',
      })

      expect(await listAgenda(salon.id, DAY, DAY_END)).toEqual([])
    })

    it('should keep no-shows visible in the agenda', async () => {
      // Le salon doit garder trace d'un client absent, contrairement à une
      // annulation.
      const { salon, service, camille, owner } = await fixture()
      const appointment = await createWalkIn(owner, {
        salonId: salon.id,
        memberId: camille.id,
        serviceIds: [service.id],
        startAt: slot(14),
        guestName: 'Client',
        source: 'SALON',
      })
      await setAppointmentStatus(owner, {
        salonId: salon.id,
        appointmentId: appointment.id,
        status: 'NO_SHOW',
      })

      const agenda = await listAgenda(salon.id, DAY, DAY_END)
      expect(agenda).toHaveLength(1)
      expect(agenda[0]?.status).toBe('NO_SHOW')
    })

    it('should include an appointment starting before the window but overlapping it', async () => {
      const { salon, service, camille, owner } = await fixture()
      await createWalkIn(owner, {
        salonId: salon.id,
        memberId: camille.id,
        serviceIds: [service.id],
        startAt: new Date('2026-07-14T23:30:00+02:00'),
        guestName: 'Nuit',
        source: 'SALON',
      })

      const agenda = await listAgenda(salon.id, DAY, DAY_END)

      expect(agenda).toHaveLength(1)
    })

    it('should not expose appointments of another salon', async () => {
      const { salon, service, camille, owner } = await fixture()
      await createWalkIn(owner, {
        salonId: salon.id,
        memberId: camille.id,
        serviceIds: [service.id],
        startAt: slot(14),
        guestName: 'Client',
        source: 'SALON',
      })
      const other = await testDb.salon.create({
        data: {
          slug: 'autre',
          name: 'Autre',
          address: 'x',
          city: 'Lyon',
          postalCode: '69000',
        },
      })

      expect(await listAgenda(other.id, DAY, DAY_END)).toEqual([])
    })

    it('should filter by hairdresser when requested', async () => {
      const { salon, service, camille, alex, owner } = await fixture()
      await createWalkIn(owner, {
        salonId: salon.id,
        memberId: camille.id,
        serviceIds: [service.id],
        startAt: slot(14),
        guestName: 'Chez Camille',
        source: 'SALON',
      })
      await createWalkIn(owner, {
        salonId: salon.id,
        memberId: alex.id,
        serviceIds: [service.id],
        startAt: slot(14),
        guestName: 'Chez Alex',
        source: 'SALON',
      })

      const agenda = await listAgenda(salon.id, DAY, DAY_END, camille.id)

      expect(agenda).toHaveLength(1)
      expect(agenda[0]?.clientName).toBe('Chez Camille')
    })

    it('should list the active staff of the salon', async () => {
      const { salon } = await fixture()

      const staff = await listAgendaStaff(salon.id)

      expect(staff.map((s) => s.displayName)).toEqual(['Alex', 'Camille'])
    })
  })

  describe('fiche client', () => {
    it('should return guest details without history', async () => {
      const { salon, service, camille, owner } = await fixture()
      const appointment = await createWalkIn(owner, {
        salonId: salon.id,
        memberId: camille.id,
        serviceIds: [service.id],
        startAt: slot(14),
        guestName: 'Madame Durand',
        guestPhone: '+33600000000',
        source: 'PHONE',
      })

      const record = await getClientRecord(salon.id, appointment.id)

      expect(record?.isGuest).toBe(true)
      expect(record?.name).toBe('Madame Durand')
      expect(record?.history).toEqual([])
    })

    it('should return the history of a registered client, limited to this salon', async () => {
      const { salon, camille } = await fixture()
      const user = await testDb.user.create({
        data: { email: 'fidele@example.fr', firstName: 'Léa', lastName: 'Petit' },
      })
      const other = await testDb.salon.create({
        data: {
          slug: 'concurrent',
          name: 'Concurrent',
          address: 'x',
          city: 'Lyon',
          postalCode: '69000',
        },
      })
      const otherMember = await testDb.salonMember.create({
        data: { salonId: other.id, displayName: 'Rival' },
      })

      const current = await testDb.appointment.create({
        data: {
          salonId: salon.id,
          memberId: camille.id,
          clientId: user.id,
          startAt: slot(14),
          endAt: slot(15),
        },
      })
      await testDb.appointment.create({
        data: {
          salonId: salon.id,
          memberId: camille.id,
          clientId: user.id,
          startAt: new Date('2026-06-15T14:00:00+02:00'),
          endAt: new Date('2026-06-15T15:00:00+02:00'),
          status: 'DONE',
        },
      })
      // Rendez-vous chez un concurrent : ne doit jamais apparaître.
      await testDb.appointment.create({
        data: {
          salonId: other.id,
          memberId: otherMember.id,
          clientId: user.id,
          startAt: new Date('2026-06-20T14:00:00+02:00'),
          endAt: new Date('2026-06-20T15:00:00+02:00'),
          status: 'DONE',
        },
      })

      const record = await getClientRecord(salon.id, current.id)

      expect(record?.isGuest).toBe(false)
      expect(record?.name).toBe('Léa Petit')
      expect(record?.history).toHaveLength(1)
    })

    it('should count the no-shows of the client in this salon', async () => {
      const { salon, camille } = await fixture()
      const user = await testDb.user.create({
        data: { email: 'absent@example.fr', firstName: 'Noah', lastName: 'M' },
      })
      const current = await testDb.appointment.create({
        data: {
          salonId: salon.id,
          memberId: camille.id,
          clientId: user.id,
          startAt: slot(14),
          endAt: slot(15),
        },
      })
      await testDb.appointment.create({
        data: {
          salonId: salon.id,
          memberId: camille.id,
          clientId: user.id,
          startAt: new Date('2026-06-15T14:00:00+02:00'),
          endAt: new Date('2026-06-15T15:00:00+02:00'),
          status: 'NO_SHOW',
        },
      })

      const record = await getClientRecord(salon.id, current.id)

      expect(record?.noShowCount).toBe(1)
    })

    it('should return null for an appointment of another salon', async () => {
      const { salon, service, camille, owner } = await fixture()
      const appointment = await createWalkIn(owner, {
        salonId: salon.id,
        memberId: camille.id,
        serviceIds: [service.id],
        startAt: slot(14),
        guestName: 'Client',
        source: 'SALON',
      })
      const other = await testDb.salon.create({
        data: {
          slug: 'autre',
          name: 'Autre',
          address: 'x',
          city: 'Lyon',
          postalCode: '69000',
        },
      })

      expect(await getClientRecord(other.id, appointment.id)).toBeNull()
    })
  })

  describe('note interne', () => {
    it('should store a staff note invisible to the client', async () => {
      const { salon, service, camille, owner } = await fixture()
      const appointment = await createWalkIn(owner, {
        salonId: salon.id,
        memberId: camille.id,
        serviceIds: [service.id],
        startAt: slot(14),
        guestName: 'Client',
        source: 'SALON',
      })

      await setStaffNote(owner, {
        salonId: salon.id,
        appointmentId: appointment.id,
        staffNote: 'Cheveux très fins, coloration douce',
      })

      const stored = await testDb.appointment.findUniqueOrThrow({
        where: { id: appointment.id },
      })
      expect(stored.staffNote).toContain('Cheveux très fins')
      expect(stored.clientNote).toBeNull()
    })
  })
})
