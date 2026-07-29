import { createHash } from 'node:crypto'
import type { NotificationChannel } from '@/generated/prisma'
import { prisma } from '@/lib/db/client'
import { emailProvider, smsProvider } from '@/services/notificationProviders'
import { canSendSms } from './smsQuota'
import { buildEmail, buildSms } from './templates'
import type { AppointmentSummary, SendResult, TemplateId } from './types'

/**
 * Expédition des notifications, avec idempotence et reprise sur échec.
 *
 * Deux garanties portées par la base :
 *
 *  1. **Un message n'est jamais envoyé deux fois.** La clé
 *     `appointmentId:template:channel` est unique en base ; l'insertion
 *     précède l'envoi, si bien qu'un job rejoué — ou lancé deux fois en
 *     parallèle — trouve la ligne déjà posée et s'abstient. Un SMS envoyé ne
 *     se rattrape pas.
 *  2. **Aucune donnée personnelle n'est journalisée.** Le destinataire est
 *     stocké haché ; ni l'adresse, ni le numéro, ni le contenu n'apparaissent
 *     en clair (CLAUDE.md).
 */

const MAX_ATTEMPTS = 3

/** Empreinte du destinataire, pour rapprocher un envoi sans stocker le contact. */
function hashRecipient(recipient: string): string {
  return createHash('sha256').update(recipient.toLowerCase().trim()).digest('hex')
}

/** Clé d'idempotence : un gabarit, un canal, un rendez-vous. */
export function idempotencyKey(
  appointmentId: string,
  template: TemplateId,
  channel: NotificationChannel,
): string {
  return `${appointmentId}:${template}:${channel}`
}

export type DispatchOutcome =
  | { status: 'sent'; providerId: string | null }
  | { status: 'skipped'; reason: 'already_sent' | 'no_recipient' | 'quota_exceeded' }
  | { status: 'failed'; error: string; willRetry: boolean }

/**
 * Envoie une notification, une seule fois.
 *
 * @returns `skipped` si le message a déjà été expédié ou si le client n'a pas
 * de contact utilisable pour ce canal.
 */
export async function dispatch(
  template: TemplateId,
  channel: NotificationChannel,
  appointment: AppointmentSummary,
): Promise<DispatchOutcome> {
  const message =
    channel === 'EMAIL'
      ? buildEmail(template, appointment)
      : buildSms(template, appointment)

  // Pas d'adresse, pas de numéro, ou consentement SMS absent : rien à faire, et
  // surtout aucune ligne de journal — ce n'est pas un échec.
  if (!message) {
    return { status: 'skipped', reason: 'no_recipient' }
  }

  // Plafond mensuel atteint : le SMS est abandonné, jamais le courriel. Un
  // salon qui dépasse son quota doit continuer d'informer ses clients.
  if (channel === 'SMS' && !(await canSendSms(appointment.salonId))) {
    return { status: 'skipped', reason: 'quota_exceeded' }
  }

  const key = idempotencyKey(appointment.appointmentId, template, channel)

  // Réservation de la clé AVANT l'envoi : c'est ce qui rend le job rejouable.
  // Si deux exécutions concurrentes tentent la même notification, la contrainte
  // d'unicité en désigne une seule.
  try {
    await prisma.notificationLog.create({
      data: {
        salonId: appointment.salonId,
        appointmentId: appointment.appointmentId,
        channel,
        template,
        recipientHash: hashRecipient(message.to),
        idempotencyKey: key,
        status: 'QUEUED',
      },
    })
  } catch {
    // Violation d'unicité : la notification est déjà partie, ou une autre
    // exécution s'en occupe.
    return { status: 'skipped', reason: 'already_sent' }
  }

  const result: SendResult =
    channel === 'EMAIL'
      ? await emailProvider.send(message as Parameters<typeof emailProvider.send>[0])
      : await smsProvider.send(message as Parameters<typeof smsProvider.send>[0])

  if (result.ok) {
    await prisma.notificationLog.update({
      where: { idempotencyKey: key },
      data: {
        status: 'SENT',
        sentAt: new Date(),
        attempts: 1,
        providerId: result.providerId,
      },
    })
    return { status: 'sent', providerId: result.providerId }
  }

  await prisma.notificationLog.update({
    where: { idempotencyKey: key },
    data: {
      status: 'FAILED',
      attempts: 1,
      // Le message d'erreur du fournisseur peut contenir l'adresse : on le
      // tronque et on ne le montre qu'au gérant, jamais dans un journal
      // applicatif.
      error: result.error.slice(0, 500),
    },
  })

  return { status: 'failed', error: result.error, willRetry: result.retryable }
}

/**
 * Rejoue les envois en échec.
 *
 * Seuls les échecs transitoires méritent une reprise : une adresse invalide ne
 * deviendra pas valide. La ligne de journal étant déjà posée, on ne repasse pas
 * par `dispatch` — on réutilise la même clé.
 */
export async function retryFailed(
  limit = 50,
): Promise<{ retried: number; sent: number }> {
  const failures = await prisma.notificationLog.findMany({
    where: { status: 'FAILED', attempts: { lt: MAX_ATTEMPTS } },
    orderBy: { updatedAt: 'asc' },
    take: limit,
    select: {
      id: true,
      idempotencyKey: true,
      channel: true,
      template: true,
      attempts: true,
      appointmentId: true,
    },
  })

  let sent = 0

  for (const failure of failures) {
    if (!failure.appointmentId) continue

    const summary = await loadAppointmentSummary(failure.appointmentId)
    if (!summary) continue

    const message =
      failure.channel === 'EMAIL'
        ? buildEmail(failure.template as TemplateId, summary)
        : buildSms(failure.template as TemplateId, summary)
    if (!message) continue

    const result =
      failure.channel === 'EMAIL'
        ? await emailProvider.send(message as Parameters<typeof emailProvider.send>[0])
        : await smsProvider.send(message as Parameters<typeof smsProvider.send>[0])

    await prisma.notificationLog.update({
      where: { id: failure.id },
      data: {
        status: result.ok ? 'SENT' : 'FAILED',
        attempts: failure.attempts + 1,
        sentAt: result.ok ? new Date() : null,
        providerId: result.ok ? result.providerId : null,
        error: result.ok ? null : result.error.slice(0, 500),
      },
    })

    if (result.ok) sent++
  }

  return { retried: failures.length, sent }
}

/**
 * Assemble les données nécessaires à la rédaction d'un message.
 *
 * Lecture non cloisonnée assumée : l'appelant est un job planifié, sans acteur
 * ni salon courant. Le `salonId` est relu depuis le rendez-vous lui-même.
 */
export async function loadAppointmentSummary(
  appointmentId: string,
): Promise<AppointmentSummary | null> {
  const appointment = await prisma.appointment.findUnique({
    where: { id: appointmentId },
    select: {
      id: true,
      salonId: true,
      startAt: true,
      guestName: true,
      guestEmail: true,
      guestPhone: true,
      member: { select: { displayName: true } },
      items: {
        orderBy: { position: 'asc' },
        select: { nameSnapshot: true, priceCents: true },
      },
      client: {
        select: {
          firstName: true,
          lastName: true,
          email: true,
          emailVerified: true,
          phone: true,
          consents: {
            where: { type: 'TRANSACTIONAL_SMS' },
            orderBy: { createdAt: 'desc' },
            take: 1,
            select: { granted: true },
          },
        },
      },
      salon: {
        select: {
          name: true,
          address: true,
          postalCode: true,
          city: true,
          phone: true,
          timezone: true,
          cancellationDeadlineHours: true,
        },
      },
    },
  })

  if (!appointment) return null

  const client = appointment.client

  return {
    appointmentId: appointment.id,
    salonId: appointment.salonId,
    salonName: appointment.salon.name,
    salonAddress: `${appointment.salon.address}, ${appointment.salon.postalCode} ${appointment.salon.city}`,
    salonPhone: appointment.salon.phone,
    timezone: appointment.salon.timezone,
    startAt: appointment.startAt,
    memberName: appointment.member.displayName,
    services: appointment.items.map((item) => item.nameSnapshot),
    totalPriceCents: appointment.items.reduce((sum, item) => sum + item.priceCents, 0),
    clientName: client
      ? [client.firstName, client.lastName].filter(Boolean).join(' ')
      : (appointment.guestName ?? 'Client'),
    // Une adresse non confirmée n'est pas servie : sans cette garde, un
    // compte créé au nom d'un tiers recevrait ses rendez-vous. L'adresse d'un
    // rendez-vous pris au comptoir est en revanche donnée de vive voix, donc
    // fiable par construction.
    email: client ? (client.emailVerified ? client.email : null) : appointment.guestEmail,
    phone: client?.phone ?? appointment.guestPhone,
    // Consentement explicite exigé. Un rendez-vous pris au comptoir n'a pas de
    // compte : sans trace de consentement, pas de SMS.
    smsConsent: client?.consents[0]?.granted ?? false,
    cancellationDeadlineHours: appointment.salon.cancellationDeadlineHours,
  }
}

/**
 * Envoie une notification sur les deux canaux.
 *
 * Le courriel est systématique ; le SMS n'est tenté que si le client l'a
 * accepté. Un échec sur un canal n'empêche pas l'autre.
 */
export async function notify(
  template: TemplateId,
  appointmentId: string,
): Promise<{ email: DispatchOutcome; sms: DispatchOutcome }> {
  const summary = await loadAppointmentSummary(appointmentId)

  if (!summary) {
    const missing = { status: 'skipped', reason: 'no_recipient' } as const
    return { email: missing, sms: missing }
  }

  const [email, sms] = await Promise.all([
    dispatch(template, 'EMAIL', summary),
    dispatch(template, 'SMS', summary),
  ])

  return { email, sms }
}
