import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { clearCache } from '@/features/availability/cache'
import {
  getConsents,
  hasSmsConsent,
  recordConsent,
} from '@/features/notifications/consent'
import {
  dispatch,
  idempotencyKey,
  loadAppointmentSummary,
  notify,
} from '@/features/notifications/dispatch'
import {
  listFailedNotifications,
  sendDueReminders,
} from '@/features/notifications/reminders'
import { getSmsQuota } from '@/features/notifications/smsQuota'
import type { Actor } from '@/lib/authz/types'
import { resetDatabase, testDb } from './helpers/db'

/**
 * Notifications transactionnelles.
 *
 * Critère d'acceptation de la phase 6 : un rappel n'est envoyé qu'une seule
 * fois, même si le job tourne deux fois. C'est la garantie qui compte le plus —
 * un SMS envoyé ne se rattrape pas, et chaque envoi est facturé.
 *
 * Les tests s'exécutent avec `NOTIFICATIONS_ENABLED=false` : les fournisseurs
 * sont inertes, aucun message ne part réellement, mais tout le cheminement —
 * clé d'idempotence, journal, statuts — est exercé.
 */

const NOW = new Date('2026-09-15T10:00:00+02:00')
/** Rendez-vous dans ~24 h : dans la fenêtre du rappel. */
const TOMORROW = new Date('2026-09-16T11:00:00+02:00')

/** Gérant du salon, seul habilité à consulter les échecs d'envoi. */
async function ownerOf(salonId: string): Promise<Actor> {
  const user = await testDb.user.create({
    data: { email: `owner-${salonId}@example.fr`, firstName: 'Julie', lastName: 'R' },
  })
  const member = await testDb.salonMember.create({
    data: { salonId, userId: user.id, role: 'OWNER', displayName: 'Julie' },
  })
  return {
    userId: user.id,
    role: 'CLIENT',
    memberships: [{ salonId, memberId: member.id, role: 'OWNER', isActive: true }],
  }
}

async function fixture(options: { withConsent?: boolean; withPhone?: boolean } = {}) {
  const salon = await testDb.salon.create({
    data: {
      slug: 'salon-notif',
      name: 'Salon Notification',
      address: '1 rue des Tests',
      city: 'Lyon',
      postalCode: '69000',
      isActive: true,
      phone: '+33478000000',
    },
  })

  const service = await testDb.service.create({
    data: { salonId: salon.id, name: 'Coupe', durationMin: 60, priceCents: 3000 },
  })

  const member = await testDb.salonMember.create({
    data: { salonId: salon.id, displayName: 'Camille' },
  })

  const user = await testDb.user.create({
    data: {
      email: 'cliente@example.fr',
      firstName: 'Léa',
      lastName: 'Petit',
      phone: options.withPhone === false ? null : '+33600000000',
    },
  })

  if (options.withConsent) {
    await testDb.consentRecord.create({
      data: {
        userId: user.id,
        type: 'TRANSACTIONAL_SMS',
        granted: true,
        source: 'inscription',
      },
    })
  }

  const appointment = await testDb.appointment.create({
    data: {
      salonId: salon.id,
      memberId: member.id,
      clientId: user.id,
      startAt: TOMORROW,
      endAt: new Date(TOMORROW.getTime() + 3_600_000),
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

  return { salon, member, user, appointment }
}

describe('notifications', () => {
  beforeEach(async () => {
    await resetDatabase()
    clearCache()
  })

  afterAll(async () => {
    await testDb.$disconnect()
  })

  describe('assemblage des données', () => {
    it('should gather everything a message needs', async () => {
      const { appointment } = await fixture()

      const summary = await loadAppointmentSummary(appointment.id)

      expect(summary?.clientName).toBe('Léa Petit')
      expect(summary?.email).toBe('cliente@example.fr')
      expect(summary?.salonName).toBe('Salon Notification')
      expect(summary?.services).toEqual(['Coupe'])
      expect(summary?.totalPriceCents).toBe(3000)
    })

    it('should report no SMS consent when none was recorded', async () => {
      // L'absence de trace vaut refus : le consentement est un acte positif.
      const { appointment } = await fixture()

      expect((await loadAppointmentSummary(appointment.id))?.smsConsent).toBe(false)
    })

    it('should report the consent when it was granted', async () => {
      const { appointment } = await fixture({ withConsent: true })

      expect((await loadAppointmentSummary(appointment.id))?.smsConsent).toBe(true)
    })

    it('should fall back on guest details for an appointment without account', async () => {
      const { salon, member } = await fixture()
      const walkIn = await testDb.appointment.create({
        data: {
          salonId: salon.id,
          memberId: member.id,
          guestName: 'Madame Durand',
          guestEmail: 'durand@example.fr',
          startAt: new Date('2026-09-20T10:00:00+02:00'),
          endAt: new Date('2026-09-20T11:00:00+02:00'),
        },
      })

      const summary = await loadAppointmentSummary(walkIn.id)

      expect(summary?.clientName).toBe('Madame Durand')
      expect(summary?.email).toBe('durand@example.fr')
      // Aucun compte, donc aucun consentement possible.
      expect(summary?.smsConsent).toBe(false)
    })

    it('should return null for an unknown appointment', async () => {
      expect(await loadAppointmentSummary('inexistant')).toBeNull()
    })
  })

  describe('idempotence', () => {
    it('should record a single log entry for one dispatch', async () => {
      const { appointment } = await fixture()
      const summary = (await loadAppointmentSummary(appointment.id))!

      const outcome = await dispatch('booking_confirmed', 'EMAIL', summary)

      expect(outcome.status).toBe('sent')
      expect(await testDb.notificationLog.count()).toBe(1)
    })

    it('should skip a second dispatch of the same message', async () => {
      const { appointment } = await fixture()
      const summary = (await loadAppointmentSummary(appointment.id))!

      await dispatch('booking_confirmed', 'EMAIL', summary)
      const second = await dispatch('booking_confirmed', 'EMAIL', summary)

      expect(second).toEqual({ status: 'skipped', reason: 'already_sent' })
      expect(await testDb.notificationLog.count()).toBe(1)
    })

    it('should let only one of two concurrent dispatches through', async () => {
      // Deux exécutions du job qui se chevauchent : la contrainte d'unicité
      // départage, comme pour la double réservation.
      const { appointment } = await fixture()
      const summary = (await loadAppointmentSummary(appointment.id))!

      const results = await Promise.all([
        dispatch('reminder_j1', 'EMAIL', summary),
        dispatch('reminder_j1', 'EMAIL', summary),
      ])

      expect(results.filter((r) => r.status === 'sent')).toHaveLength(1)
      expect(results.filter((r) => r.status === 'skipped')).toHaveLength(1)
      expect(await testDb.notificationLog.count()).toBe(1)
    })

    it('should treat each channel independently', async () => {
      const { appointment } = await fixture({ withConsent: true })
      const summary = (await loadAppointmentSummary(appointment.id))!

      await dispatch('reminder_j1', 'EMAIL', summary)
      const sms = await dispatch('reminder_j1', 'SMS', summary)

      expect(sms.status).toBe('sent')
      expect(await testDb.notificationLog.count()).toBe(2)
    })

    it('should treat each template independently', async () => {
      const { appointment } = await fixture()
      const summary = (await loadAppointmentSummary(appointment.id))!

      await dispatch('booking_confirmed', 'EMAIL', summary)
      const reminder = await dispatch('reminder_j1', 'EMAIL', summary)

      expect(reminder.status).toBe('sent')
    })

    it('should build a key from appointment, template and channel', () => {
      expect(idempotencyKey('rdv-1', 'reminder_j1', 'SMS')).toBe('rdv-1:reminder_j1:SMS')
    })
  })

  describe('confidentialité du journal', () => {
    it('should never store the recipient in clear text', async () => {
      // Le CLAUDE.md interdit toute donnée personnelle dans les journaux.
      const { appointment } = await fixture()
      const summary = (await loadAppointmentSummary(appointment.id))!

      await dispatch('booking_confirmed', 'EMAIL', summary)

      const log = await testDb.notificationLog.findFirstOrThrow()
      expect(log.recipientHash).not.toContain('cliente@example.fr')
      expect(log.recipientHash).toHaveLength(64) // SHA-256 hexadécimal
    })

    it('should produce the same hash for the same recipient', async () => {
      const { appointment } = await fixture()
      const summary = (await loadAppointmentSummary(appointment.id))!

      await dispatch('booking_confirmed', 'EMAIL', summary)
      await dispatch('reminder_j1', 'EMAIL', summary)

      const logs = await testDb.notificationLog.findMany()
      expect(logs[0]?.recipientHash).toBe(logs[1]?.recipientHash)
    })
  })

  describe('destinataires manquants', () => {
    it('should skip without recording a log when there is no email', async () => {
      const { salon, member } = await fixture()
      const walkIn = await testDb.appointment.create({
        data: {
          salonId: salon.id,
          memberId: member.id,
          guestName: 'Sans contact',
          startAt: new Date('2026-09-20T10:00:00+02:00'),
          endAt: new Date('2026-09-20T11:00:00+02:00'),
        },
      })
      const summary = (await loadAppointmentSummary(walkIn.id))!

      const outcome = await dispatch('booking_confirmed', 'EMAIL', summary)

      expect(outcome).toEqual({ status: 'skipped', reason: 'no_recipient' })
      // Aucune ligne : ce n'est pas un échec, il n'y a simplement rien à faire.
      expect(await testDb.notificationLog.count()).toBe(0)
    })

    it('should skip the SMS when consent is missing', async () => {
      const { appointment } = await fixture()
      const summary = (await loadAppointmentSummary(appointment.id))!

      const outcome = await dispatch('reminder_j1', 'SMS', summary)

      expect(outcome).toEqual({ status: 'skipped', reason: 'no_recipient' })
    })
  })

  describe('notify sur les deux canaux', () => {
    it('should send email and SMS when both are possible', async () => {
      const { appointment } = await fixture({ withConsent: true })

      const result = await notify('booking_confirmed', appointment.id)

      expect(result.email.status).toBe('sent')
      expect(result.sms.status).toBe('sent')
    })

    it('should send only the email without SMS consent', async () => {
      const { appointment } = await fixture()

      const result = await notify('booking_confirmed', appointment.id)

      expect(result.email.status).toBe('sent')
      expect(result.sms.status).toBe('skipped')
    })

    it('should not throw for an unknown appointment', async () => {
      // Appelé depuis la réservation : une notification impossible ne doit
      // jamais faire échouer la prise de rendez-vous.
      const result = await notify('booking_confirmed', 'inexistant')

      expect(result.email.status).toBe('skipped')
    })
  })

  describe('rappel J-1', () => {
    it('should remind an appointment starting in about 24 hours', async () => {
      const { appointment } = await fixture()

      const run = await sendDueReminders(NOW)

      expect(run.scanned).toBe(1)
      expect(run.emailsSent).toBe(1)

      const log = await testDb.notificationLog.findFirstOrThrow()
      expect(log.template).toBe('reminder_j1')
      expect(log.appointmentId).toBe(appointment.id)
    })

    it('should not remind an appointment outside the window', async () => {
      const { salon, member, user } = await fixture()
      await testDb.appointment.deleteMany({})
      await testDb.appointment.create({
        data: {
          salonId: salon.id,
          memberId: member.id,
          clientId: user.id,
          // Dans une semaine : hors fenêtre.
          startAt: new Date('2026-09-22T11:00:00+02:00'),
          endAt: new Date('2026-09-22T12:00:00+02:00'),
        },
      })

      const run = await sendDueReminders(NOW)

      expect(run.scanned).toBe(0)
    })

    it('should not remind a cancelled appointment', async () => {
      const { appointment } = await fixture()
      await testDb.appointment.update({
        where: { id: appointment.id },
        data: { status: 'CANCELLED' },
      })

      expect((await sendDueReminders(NOW)).scanned).toBe(0)
    })

    it('should not remind clients of a suspended salon', async () => {
      const { salon } = await fixture()
      await testDb.salon.update({ where: { id: salon.id }, data: { isActive: false } })

      expect((await sendDueReminders(NOW)).scanned).toBe(0)
    })

    it('should send exactly one reminder even if the job runs twice', async () => {
      // ⚠️ Le critère d'acceptation de la phase. Le job est conçu pour être
      // rejouable : il tourne toutes les heures sur une fenêtre de deux heures.
      await fixture({ withConsent: true })

      const first = await sendDueReminders(NOW)
      const second = await sendDueReminders(NOW)

      expect(first.emailsSent).toBe(1)
      expect(first.smsSent).toBe(1)
      // La seconde exécution ne renvoie rien.
      expect(second.emailsSent).toBe(0)
      expect(second.smsSent).toBe(0)
      expect(second.skipped).toBe(2)

      expect(await testDb.notificationLog.count()).toBe(2)
    })

    it('should send exactly one reminder across many runs', async () => {
      await fixture()

      for (let i = 0; i < 5; i++) {
        await sendDueReminders(NOW)
      }

      expect(
        await testDb.notificationLog.count({ where: { template: 'reminder_j1' } }),
      ).toBe(1)
    })
  })

  describe('échecs remontés au gérant', () => {
    it('should list definitive failures of the salon', async () => {
      const { salon, appointment } = await fixture()
      await testDb.notificationLog.create({
        data: {
          salonId: salon.id,
          appointmentId: appointment.id,
          channel: 'EMAIL',
          template: 'reminder_j1',
          recipientHash: 'a'.repeat(64),
          idempotencyKey: 'echec-1',
          status: 'FAILED',
          attempts: 3,
          error: 'Adresse invalide',
        },
      })

      const failures = await listFailedNotifications(await ownerOf(salon.id), salon.id)

      expect(failures).toHaveLength(1)
      expect(failures[0]?.error).toBe('Adresse invalide')
    })

    it('should not list failures still awaiting a retry', async () => {
      const { salon, appointment } = await fixture()
      await testDb.notificationLog.create({
        data: {
          salonId: salon.id,
          appointmentId: appointment.id,
          channel: 'EMAIL',
          template: 'reminder_j1',
          recipientHash: 'a'.repeat(64),
          idempotencyKey: 'echec-2',
          status: 'FAILED',
          attempts: 1,
          error: 'Panne passagère',
        },
      })

      expect(await listFailedNotifications(await ownerOf(salon.id), salon.id)).toEqual([])
    })

    it('should not expose failures of another salon', async () => {
      const { salon, appointment } = await fixture()
      await testDb.notificationLog.create({
        data: {
          salonId: salon.id,
          appointmentId: appointment.id,
          channel: 'EMAIL',
          template: 'reminder_j1',
          recipientHash: 'a'.repeat(64),
          idempotencyKey: 'echec-3',
          status: 'FAILED',
          attempts: 3,
        },
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

      // Le gérant du premier salon n'a aucun droit sur le second.
      await expect(
        listFailedNotifications(await ownerOf(salon.id), other.id),
      ).rejects.toThrow()
    })
  })

  describe('consentements', () => {
    it('should default every consent to false', async () => {
      const { user } = await fixture()

      const consents = await getConsents(user.id)

      expect(consents.TRANSACTIONAL_SMS).toBe(false)
      expect(consents.MARKETING_EMAIL).toBe(false)
    })

    it('should record a decision and keep the history', async () => {
      const { user } = await fixture()
      const actor: Actor = { userId: user.id, role: 'CLIENT', memberships: [] }

      await recordConsent(actor, 'TRANSACTIONAL_SMS', true, 'inscription')
      await recordConsent(actor, 'TRANSACTIONAL_SMS', false, 'espace client')

      // La décision la plus récente fait foi…
      expect(await hasSmsConsent(user.id)).toBe(false)
      // …mais l'historique est conservé, comme preuve.
      expect(await testDb.consentRecord.count()).toBe(2)
    })

    it('should keep consents independent from one another', async () => {
      const { user } = await fixture()
      const actor: Actor = { userId: user.id, role: 'CLIENT', memberships: [] }

      await recordConsent(actor, 'TRANSACTIONAL_SMS', true, 'inscription')

      const consents = await getConsents(user.id)
      expect(consents.TRANSACTIONAL_SMS).toBe(true)
      expect(consents.MARKETING_SMS).toBe(false)
    })
  })
})

describe('plafond mensuel de SMS', () => {
  beforeEach(async () => {
    await resetDatabase()
    clearCache()
  })

  it('should send the SMS while the quota allows it', async () => {
    const { appointment } = await fixture({ withConsent: true })
    const summary = (await loadAppointmentSummary(appointment.id))!

    expect((await dispatch('reminder_j1', 'SMS', summary)).status).toBe('sent')
  })

  it('should skip the SMS once the quota is reached', async () => {
    // Chaque SMS est facturé : le plafond protège d'une facture non maîtrisée.
    const { salon, appointment } = await fixture({ withConsent: true })
    await testDb.salon.update({
      where: { id: salon.id },
      data: { smsMonthlyQuota: 1 },
    })
    const summary = (await loadAppointmentSummary(appointment.id))!

    await dispatch('booking_confirmed', 'SMS', summary)
    const second = await dispatch('reminder_j1', 'SMS', summary)

    expect(second).toEqual({ status: 'skipped', reason: 'quota_exceeded' })
  })

  it('should keep sending emails when the SMS quota is exhausted', async () => {
    // Un salon qui dépasse son plafond doit continuer d'informer ses clients.
    const { salon, appointment } = await fixture({ withConsent: true })
    await testDb.salon.update({
      where: { id: salon.id },
      data: { smsMonthlyQuota: 0 },
    })

    const result = await notify('booking_confirmed', appointment.id)

    expect(result.email.status).toBe('sent')
    expect(result.sms).toEqual({ status: 'skipped', reason: 'quota_exceeded' })
  })

  it('should disable SMS entirely with a zero quota', async () => {
    const { salon, appointment } = await fixture({ withConsent: true })
    await testDb.salon.update({
      where: { id: salon.id },
      data: { smsMonthlyQuota: 0 },
    })
    const summary = (await loadAppointmentSummary(appointment.id))!

    expect((await dispatch('reminder_j1', 'SMS', summary)).status).toBe('skipped')
  })

  it('should not count failed sends against the quota', async () => {
    // Un SMS en échec n'est pas facturé.
    const { salon, appointment } = await fixture({ withConsent: true })
    await testDb.salon.update({
      where: { id: salon.id },
      data: { smsMonthlyQuota: 1 },
    })
    await testDb.notificationLog.create({
      data: {
        salonId: salon.id,
        appointmentId: appointment.id,
        channel: 'SMS',
        template: 'booking_confirmed',
        recipientHash: 'a'.repeat(64),
        idempotencyKey: 'echec-sms',
        status: 'FAILED',
        attempts: 3,
      },
    })
    const summary = (await loadAppointmentSummary(appointment.id))!

    expect((await dispatch('reminder_j1', 'SMS', summary)).status).toBe('sent')
  })

  it('should report the quota state of the salon', async () => {
    const { salon, appointment } = await fixture({ withConsent: true })
    const summary = (await loadAppointmentSummary(appointment.id))!
    await dispatch('booking_confirmed', 'SMS', summary)

    const quota = await getSmsQuota(salon.id)

    expect(quota.used).toBe(1)
    expect(quota.quota).toBe(500)
    expect(quota.exceeded).toBe(false)
  })
})
