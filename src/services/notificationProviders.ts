import { Resend } from 'resend'
import twilio from 'twilio'
import { env } from '@/lib/env.server'
import type {
  EmailMessage,
  EmailProvider,
  SendResult,
  SmsMessage,
  SmsProvider,
} from '@/features/notifications/types'

/**
 * Fournisseurs d'envoi : Resend pour les courriels, Twilio pour les SMS.
 *
 * ⚠️ Coupe-circuit : tant que `NOTIFICATIONS_ENABLED` vaut `false`, aucun
 * message ne quitte le processus. C'est ce qui empêche une préproduction
 * d'écrire à de vrais clients — et un SMS envoyé ne se rattrape pas.
 */

/** Fournisseur inerte : journalise l'intention sans rien envoyer. */
class InertProvider implements EmailProvider, SmsProvider {
  constructor(private readonly label: string) {}

  async send(message: EmailMessage | SmsMessage): Promise<SendResult> {
    // Aucune donnée personnelle : ni adresse, ni numéro, ni contenu du message
    // (CLAUDE.md). Seul le canal est tracé.
    console.warn(
      `[notifications] ${this.label} non envoyé : coupe-circuit ouvert ` +
        `(NOTIFICATIONS_ENABLED=false). Destinataire masqué, ${message.to.length} caractères.`,
    )
    return { ok: true, providerId: null }
  }
}

/**
 * Détermine si une erreur mérite une nouvelle tentative.
 *
 * Une adresse invalide ou un numéro inexistant ne deviendra pas valide en
 * réessayant : seuls les incidents transitoires sont rejoués.
 */
function isRetryable(status: number | undefined): boolean {
  if (status === undefined) return true // panne réseau, sans réponse
  if (status === 429) return true // quota momentané
  return status >= 500
}

class ResendProvider implements EmailProvider {
  private readonly client: Resend

  constructor(apiKey: string) {
    this.client = new Resend(apiKey)
  }

  async send(message: EmailMessage): Promise<SendResult> {
    try {
      const { data, error } = await this.client.emails.send({
        from: env.EMAIL_FROM!,
        to: message.to,
        subject: message.subject,
        html: message.html,
        text: message.text,
      })

      if (error) {
        return {
          ok: false,
          error: error.message,
          // Resend expose `name` plutôt qu'un code HTTP : on ne rejoue que les
          // incidents manifestement transitoires.
          retryable:
            error.name === 'rate_limit_exceeded' ||
            error.name === 'internal_server_error',
        }
      }

      return { ok: true, providerId: data?.id ?? null }
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : 'Erreur inconnue',
        retryable: true,
      }
    }
  }
}

class TwilioProvider implements SmsProvider {
  private readonly client: ReturnType<typeof twilio>

  constructor(
    accountSid: string,
    authToken: string,
    private readonly from: string,
  ) {
    this.client = twilio(accountSid, authToken)
  }

  async send(message: SmsMessage): Promise<SendResult> {
    try {
      const result = await this.client.messages.create({
        from: this.from,
        to: message.to,
        body: message.body,
      })
      return { ok: true, providerId: result.sid }
    } catch (error) {
      const status = (error as { status?: number }).status
      return {
        ok: false,
        error: error instanceof Error ? error.message : 'Erreur inconnue',
        retryable: isRetryable(status),
      }
    }
  }
}

/**
 * Fournisseurs effectifs, résolus une fois au démarrage.
 *
 * Les identifiants sont garantis présents quand le coupe-circuit est armé :
 * `env.schema.ts` refuse de démarrer sinon.
 */
export const emailProvider: EmailProvider = env.NOTIFICATIONS_ENABLED
  ? new ResendProvider(env.RESEND_API_KEY!)
  : new InertProvider('courriel')

export const smsProvider: SmsProvider = env.NOTIFICATIONS_ENABLED
  ? new TwilioProvider(
      env.TWILIO_ACCOUNT_SID!,
      env.TWILIO_AUTH_TOKEN!,
      env.TWILIO_PHONE_NUMBER!,
    )
  : new InertProvider('SMS')
