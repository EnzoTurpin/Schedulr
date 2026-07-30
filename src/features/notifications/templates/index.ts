import { formatDate, formatPrice } from '@/lib/format'
import type { AppointmentSummary, EmailMessage, SmsMessage, TemplateId } from '../types'

/**
 * Rédaction des messages transactionnels.
 *
 * Fonctions pures : elles reçoivent un rendez-vous et rendent un message. Aucun
 * accès au réseau ni à la base, ce qui les rend testables intégralement.
 *
 * Pas de bibliothèque de gabarits : ces courriels tiennent en quelques
 * paragraphes, et une dépendance supplémentaire dans le lot serveur ne se
 * justifierait pas.
 */

/**
 * Échappe le HTML.
 *
 * Un nom de client ou un nom de salon vient de la saisie utilisateur : sans
 * échappement, `<script>` finirait dans le courriel. Les fournisseurs
 * n'assainissent rien.
 */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/** Date et heure du rendez-vous, dans le fuseau du salon. */
function when(appointment: AppointmentSummary): string {
  return formatDate(appointment.startAt, appointment.timezone, "EEEE d MMMM 'à' HH'h'mm")
}

/** Enveloppe HTML commune. Styles en ligne : les clients de messagerie ignorent `<style>`. */
function wrap(title: string, body: string): string {
  return [
    '<!doctype html><html lang="fr"><body style="margin:0;padding:24px;background:#f8fafc;font-family:system-ui,sans-serif;color:#0f172a">',
    '<div style="max-width:520px;margin:0 auto;background:#fff;border-radius:8px;padding:32px">',
    `<h1 style="margin:0 0 16px;font-size:20px">${escapeHtml(title)}</h1>`,
    body,
    '<p style="margin:32px 0 0;font-size:12px;color:#64748b">Message automatique — merci de ne pas y répondre.</p>',
    '</div></body></html>',
  ].join('')
}

/** Bloc récapitulatif partagé par tous les courriels. */
function summaryHtml(appointment: AppointmentSummary): string {
  const rows: [string, string][] = [
    ['Salon', appointment.salonName],
    ['Adresse', appointment.salonAddress],
    ['Date', when(appointment)],
    ['Coiffeur', appointment.memberName],
    ['Prestations', appointment.services.join(', ')],
    ['Total', formatPrice(appointment.totalPriceCents)],
  ]

  return [
    '<table style="width:100%;border-collapse:collapse;font-size:14px">',
    ...rows.map(
      ([label, value]) =>
        `<tr><td style="padding:6px 0;color:#64748b;width:120px">${escapeHtml(label)}</td>` +
        `<td style="padding:6px 0">${escapeHtml(value)}</td></tr>`,
    ),
    '</table>',
  ].join('')
}

function summaryText(appointment: AppointmentSummary): string {
  return [
    `Salon : ${appointment.salonName}`,
    `Adresse : ${appointment.salonAddress}`,
    `Date : ${when(appointment)}`,
    `Coiffeur : ${appointment.memberName}`,
    `Prestations : ${appointment.services.join(', ')}`,
    `Total : ${formatPrice(appointment.totalPriceCents)}`,
  ].join('\n')
}

const EMAIL_BUILDERS: Record<
  TemplateId,
  (appointment: AppointmentSummary) => Omit<EmailMessage, 'to'>
> = {
  booking_confirmed: (appointment) => ({
    subject: `Rendez-vous confirmé — ${appointment.salonName}`,
    html: wrap(
      'Votre rendez-vous est confirmé',
      [
        `<p style="margin:0 0 20px">Bonjour ${escapeHtml(appointment.clientName)},</p>`,
        summaryHtml(appointment),
        `<p style="margin:24px 0 0;font-size:14px;color:#64748b">Le règlement s’effectue au salon. ` +
          `Vous pouvez annuler en ligne jusqu’à ${appointment.cancellationDeadlineHours} h avant le rendez-vous.</p>`,
      ].join(''),
    ),
    text: [
      `Bonjour ${appointment.clientName},`,
      '',
      'Votre rendez-vous est confirmé.',
      '',
      summaryText(appointment),
      '',
      `Le règlement s’effectue au salon. Annulation en ligne possible jusqu’à ${appointment.cancellationDeadlineHours} h avant.`,
    ].join('\n'),
  }),

  booking_updated: (appointment) => ({
    subject: `Rendez-vous modifié — ${appointment.salonName}`,
    html: wrap(
      'Votre rendez-vous a changé',
      [
        `<p style="margin:0 0 20px">Bonjour ${escapeHtml(appointment.clientName)},</p>`,
        '<p style="margin:0 0 20px">Votre rendez-vous a été déplacé. Voici les nouvelles informations :</p>',
        summaryHtml(appointment),
        appointment.salonPhone
          ? `<p style="margin:24px 0 0;font-size:14px;color:#64748b">Cet horaire ne vous convient pas ? Appelez le ${escapeHtml(appointment.salonPhone)}.</p>`
          : '<p style="margin:24px 0 0;font-size:14px;color:#64748b">Cet horaire ne vous convient pas ? Contactez le salon.</p>',
      ].join(''),
    ),
    text: [
      `Bonjour ${appointment.clientName},`,
      '',
      'Votre rendez-vous a été déplacé. Nouvelles informations :',
      '',
      summaryText(appointment),
    ].join('\n'),
  }),

  booking_cancelled: (appointment) => ({
    subject: `Rendez-vous annulé — ${appointment.salonName}`,
    html: wrap(
      'Votre rendez-vous a été annulé',
      [
        `<p style="margin:0 0 20px">Bonjour ${escapeHtml(appointment.clientName)},</p>`,
        '<p style="margin:0 0 20px">Le rendez-vous suivant a été annulé :</p>',
        summaryHtml(appointment),
        appointment.salonPhone
          ? `<p style="margin:24px 0 0;font-size:14px;color:#64748b">Pour reprendre rendez-vous, appelez le ${escapeHtml(appointment.salonPhone)} ou réservez en ligne.</p>`
          : '<p style="margin:24px 0 0;font-size:14px;color:#64748b">Vous pouvez reprendre rendez-vous en ligne à tout moment.</p>',
      ].join(''),
    ),
    text: [
      `Bonjour ${appointment.clientName},`,
      '',
      'Le rendez-vous suivant a été annulé :',
      '',
      summaryText(appointment),
    ].join('\n'),
  }),

  reminder_j1: (appointment) => ({
    subject: `Rappel : rendez-vous demain — ${appointment.salonName}`,
    html: wrap(
      'Votre rendez-vous est demain',
      [
        `<p style="margin:0 0 20px">Bonjour ${escapeHtml(appointment.clientName)},</p>`,
        summaryHtml(appointment),
        appointment.salonPhone
          ? `<p style="margin:24px 0 0;font-size:14px;color:#64748b">Un empêchement ? Prévenez le salon au ${escapeHtml(appointment.salonPhone)}.</p>`
          : '',
      ].join(''),
    ),
    text: [
      `Bonjour ${appointment.clientName},`,
      '',
      'Rappel : votre rendez-vous est demain.',
      '',
      summaryText(appointment),
    ].join('\n'),
  }),
}

/**
 * Corps des SMS.
 *
 * Chaque message est facturé : on vise un seul segment (160 caractères en
 * GSM-7). La mention STOP est obligatoire pour un envoi commercial en France ;
 * elle est conservée ici bien que le message soit transactionnel, le client
 * devant pouvoir se désinscrire sans effort.
 */
const SMS_BUILDERS: Record<TemplateId, (appointment: AppointmentSummary) => string> = {
  booking_confirmed: (appointment) =>
    `${appointment.salonName} : rendez-vous confirmé ${when(appointment)} avec ${appointment.memberName}. STOP au 36111`,

  booking_updated: (appointment) =>
    `${appointment.salonName} : votre rendez-vous est déplacé au ${when(appointment)} avec ${appointment.memberName}. STOP au 36111`,

  booking_cancelled: (appointment) =>
    `${appointment.salonName} : votre rendez-vous du ${when(appointment)} est annulé. STOP au 36111`,

  reminder_j1: (appointment) =>
    `${appointment.salonName} : rappel, rendez-vous demain ${formatDate(appointment.startAt, appointment.timezone, "HH'h'mm")} avec ${appointment.memberName}. STOP au 36111`,
}

export function buildEmail(
  template: TemplateId,
  appointment: AppointmentSummary,
): EmailMessage | null {
  if (!appointment.email) return null
  return { to: appointment.email, ...EMAIL_BUILDERS[template](appointment) }
}

export function buildSms(
  template: TemplateId,
  appointment: AppointmentSummary,
): SmsMessage | null {
  // Deux conditions cumulatives : un numéro, et un consentement explicite.
  if (!appointment.phone || !appointment.smsConsent) return null
  return { to: appointment.phone, body: SMS_BUILDERS[template](appointment) }
}
