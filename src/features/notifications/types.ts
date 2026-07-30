import type { NotificationChannel } from '@/generated/prisma'

/**
 * Contrat d'envoi des notifications.
 *
 * Les fournisseurs sont derrière une interface étroite : cela permet de les
 * remplacer, et surtout de les neutraliser lorsque le coupe-circuit
 * `NOTIFICATIONS_ENABLED` est ouvert. Aucun test n'atteint le réseau.
 */

export type EmailMessage = {
  to: string
  subject: string
  html: string
  /** Repli pour les clients qui n'affichent pas le HTML. */
  text: string
}

export type SmsMessage = {
  to: string
  body: string
}

/** Résultat d'un envoi, quel que soit le canal. */
export type SendResult =
  | { ok: true; providerId: string | null }
  | { ok: false; error: string; retryable: boolean }

export interface EmailProvider {
  send(message: EmailMessage): Promise<SendResult>
}

export interface SmsProvider {
  send(message: SmsMessage): Promise<SendResult>
}

/** Gabarits disponibles. La valeur sert de clé d'idempotence et de journal. */
export const TEMPLATES = [
  'booking_confirmed',
  'booking_updated',
  'booking_cancelled',
  'reminder_j1',
] as const

export type TemplateId = (typeof TEMPLATES)[number]

/** Données d'un rendez-vous nécessaires à la rédaction d'un message. */
export type AppointmentSummary = {
  appointmentId: string
  salonId: string
  salonName: string
  salonAddress: string
  salonPhone: string | null
  timezone: string
  startAt: Date
  memberName: string
  services: string[]
  totalPriceCents: number
  clientName: string
  /** Destinataires ; absents pour un rendez-vous pris au comptoir sans contact. */
  email: string | null
  phone: string | null
  /** Le client a-t-il accepté les SMS transactionnels ? */
  smsConsent: boolean
  cancellationDeadlineHours: number
}

export type DispatchRequest = {
  template: TemplateId
  channel: NotificationChannel
  appointment: AppointmentSummary
}
