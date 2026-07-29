import { emailProvider } from '@/services/notificationProviders'
import { clientEnv } from '@/lib/env.client'
import type { EmailMessage } from './types'

/**
 * Courriels d'authentification.
 *
 * Distincts des notifications transactionnelles : ils ne passent pas par
 * `NotificationLog`. Ce journal est indexé par rendez-vous, et son idempotence
 * empêcherait justement le renvoi d'un lien — or un utilisateur qui n'a rien
 * reçu doit pouvoir redemander.
 */

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

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

/** Bouton d'action. L'URL est aussi donnée en clair : certains clients de messagerie masquent les liens. */
function actionButton(url: string, label: string): string {
  return [
    `<p style="margin:24px 0"><a href="${escapeHtml(url)}" style="display:inline-block;background:#7c3aed;color:#fff;padding:12px 20px;border-radius:6px;text-decoration:none;font-weight:500">${escapeHtml(label)}</a></p>`,
    `<p style="margin:16px 0 0;font-size:12px;color:#64748b;word-break:break-all">Si le bouton ne fonctionne pas : ${escapeHtml(url)}</p>`,
  ].join('')
}

/** Lien de connexion sans mot de passe. */
export function buildMagicLinkEmail(to: string, token: string): EmailMessage {
  const url = `${clientEnv.NEXT_PUBLIC_APP_URL}/api/connexion/lien?jeton=${encodeURIComponent(token)}`

  return {
    to,
    subject: 'Votre lien de connexion — Schedulr',
    html: wrap(
      'Connexion à Schedulr',
      [
        '<p style="margin:0">Cliquez pour vous connecter. Ce lien expire dans 15 minutes et ne fonctionne qu’une fois.</p>',
        actionButton(url, 'Me connecter'),
        '<p style="margin:24px 0 0;font-size:14px;color:#64748b">Vous n’avez rien demandé ? Ignorez ce message : personne ne peut se connecter sans ce lien.</p>',
      ].join(''),
    ),
    text: [
      'Connexion à Schedulr',
      '',
      'Ouvrez ce lien pour vous connecter. Il expire dans 15 minutes et ne fonctionne qu’une fois.',
      '',
      url,
      '',
      'Vous n’avez rien demandé ? Ignorez ce message.',
    ].join('\n'),
  }
}

/** Confirmation d'adresse, envoyée à l'inscription. */
export function buildVerificationEmail(to: string, token: string): EmailMessage {
  const url = `${clientEnv.NEXT_PUBLIC_APP_URL}/api/compte/verification?jeton=${encodeURIComponent(token)}`

  return {
    to,
    subject: 'Confirmez votre adresse — Schedulr',
    html: wrap(
      'Confirmez votre adresse',
      [
        '<p style="margin:0">Confirmez cette adresse pour recevoir les confirmations et rappels de vos rendez-vous. Ce lien expire dans 24 heures.</p>',
        actionButton(url, 'Confirmer mon adresse'),
        '<p style="margin:24px 0 0;font-size:14px;color:#64748b">Vous n’avez pas créé de compte ? Ignorez ce message : sans cette confirmation, aucun courriel ne vous sera envoyé.</p>',
      ].join(''),
    ),
    text: [
      'Confirmez votre adresse',
      '',
      'Ouvrez ce lien pour confirmer votre adresse. Il expire dans 24 heures.',
      '',
      url,
      '',
      'Vous n’avez pas créé de compte ? Ignorez ce message.',
    ].join('\n'),
  }
}

/**
 * Alerte envoyée au titulaire d'une adresse déjà inscrite.
 *
 * L'inscription ne dit pas à son auteur que l'adresse est prise — ce serait un
 * moyen d'énumérer les comptes. Le titulaire légitime, lui, doit l'apprendre :
 * c'est son seul indice qu'on tente d'utiliser son adresse.
 */
export function buildDuplicateSignupEmail(to: string): EmailMessage {
  const url = `${clientEnv.NEXT_PUBLIC_APP_URL}/connexion`

  return {
    to,
    subject: 'Tentative d’inscription avec votre adresse — Schedulr',
    html: wrap(
      'Une inscription a été tentée',
      [
        '<p style="margin:0">Quelqu’un vient d’essayer de créer un compte avec cette adresse. Votre compte existant n’a pas été modifié et reste accessible.</p>',
        '<p style="margin:16px 0 0">Si c’était vous, connectez-vous simplement. Sinon, aucune action n’est nécessaire.</p>',
        actionButton(url, 'Me connecter'),
      ].join(''),
    ),
    text: [
      'Une inscription a été tentée avec votre adresse.',
      '',
      'Votre compte existant n’a pas été modifié. Si c’était vous, connectez-vous :',
      '',
      url,
      '',
      'Sinon, aucune action n’est nécessaire.',
    ].join('\n'),
  }
}

/** Invitation à rejoindre l'équipe d'un salon. */
export function buildInvitationEmail(
  to: string,
  token: string,
  salonName: string,
  memberName: string,
): EmailMessage {
  const url = `${clientEnv.NEXT_PUBLIC_APP_URL}/invitation?jeton=${encodeURIComponent(token)}`

  return {
    to,
    subject: `Rejoindre l’équipe de ${salonName} — Schedulr`,
    html: wrap(
      `Rejoignez ${salonName}`,
      [
        `<p style="margin:0">Le salon <strong>${escapeHtml(salonName)}</strong> vous invite à rattacher votre compte à la fiche « ${escapeHtml(memberName)} », pour accéder à votre agenda.</p>`,
        actionButton(url, 'Accepter l’invitation'),
        '<p style="margin:24px 0 0;font-size:14px;color:#64748b">Cette invitation expire dans 7 jours. Vous devrez vous connecter avec l’adresse à laquelle ce message a été envoyé.</p>',
      ].join(''),
    ),
    text: [
      `Rejoignez ${salonName}`,
      '',
      `Le salon ${salonName} vous invite à rattacher votre compte à la fiche « ${memberName} ».`,
      '',
      url,
      '',
      'Cette invitation expire dans 7 jours.',
    ].join('\n'),
  }
}

/**
 * Envoie un courriel d'authentification.
 *
 * L'échec n'est pas remonté à l'appelant : lui dire qu'un envoi a échoué
 * révélerait que l'adresse existe. L'erreur est journalisée sans l'adresse.
 */
export async function sendAuthEmail(message: EmailMessage): Promise<void> {
  const result = await emailProvider.send(message)

  if (!result.ok) {
    console.error('[auth] envoi impossible', { error: result.error })
  }
}
