import { prisma } from '@/lib/db/client'
import { dispatch, loadAppointmentSummary, retryFailed } from './dispatch'

/**
 * Rappel de rendez-vous à J-1.
 *
 * Le job balaie une fenêtre glissante et s'appuie sur l'idempotence pour ne
 * jamais doubler un envoi : il peut donc tourner plus souvent que nécessaire,
 * être rejoué après un incident, ou se chevaucher avec lui-même sans dommage.
 * C'est ce qui permet de le déclencher toutes les heures sans tenir d'état.
 */

/** Fenêtre visée : les rendez-vous commençant dans ~24 h. */
const LEAD_HOURS = 24

/**
 * Largeur de la fenêtre.
 *
 * Le job tourne toutes les heures ; une fenêtre de deux heures garantit qu'un
 * rendez-vous reste couvert même si une exécution est manquée. Les doublons
 * que cela produit sont absorbés par la clé d'idempotence.
 */
const WINDOW_HOURS = 2

export type ReminderRun = {
  scanned: number
  emailsSent: number
  smsSent: number
  skipped: number
  failed: number
  retried: number
}

/**
 * Envoie les rappels dus.
 *
 * @param now Injecté pour rendre les tests déterministes.
 */
export async function sendDueReminders(now = new Date()): Promise<ReminderRun> {
  const from = new Date(now.getTime() + LEAD_HOURS * 3_600_000)
  const to = new Date(from.getTime() + WINDOW_HOURS * 3_600_000)

  const appointments = await prisma.appointment.findMany({
    where: {
      status: { in: ['PENDING', 'CONFIRMED'] },
      startAt: { gte: from, lt: to },
      // Le salon doit être actif : un salon suspendu ne doit plus écrire à ses
      // clients.
      salon: { isActive: true },
    },
    select: { id: true },
  })

  const run: ReminderRun = {
    scanned: appointments.length,
    emailsSent: 0,
    smsSent: 0,
    skipped: 0,
    failed: 0,
    retried: 0,
  }

  for (const appointment of appointments) {
    const summary = await loadAppointmentSummary(appointment.id)
    if (!summary) continue

    // Séquentiel plutôt que parallèle : les fournisseurs appliquent des quotas,
    // et un rappel qui part une minute plus tard reste utile.
    const email = await dispatch('reminder_j1', 'EMAIL', summary)
    const sms = await dispatch('reminder_j1', 'SMS', summary)

    for (const outcome of [email, sms]) {
      if (outcome.status === 'sent') {
        if (outcome === email) run.emailsSent++
        else run.smsSent++
      } else if (outcome.status === 'skipped') {
        run.skipped++
      } else {
        run.failed++
      }
    }
  }

  // Les échecs transitoires des exécutions précédentes sont rejoués ici :
  // inutile d'un second job pour cela.
  const retry = await retryFailed()
  run.retried = retry.retried

  return run
}

/**
 * Envois en échec définitif d'un salon, pour affichage au gérant.
 *
 * Un rappel qui n'est jamais parti est une information que le salon doit avoir :
 * le client viendra peut-être sans avoir été prévenu d'un changement.
 */
export async function listFailedNotifications(salonId: string, limit = 20) {
  return prisma.notificationLog.findMany({
    where: { salonId, status: 'FAILED', attempts: { gte: 3 } },
    orderBy: { updatedAt: 'desc' },
    take: limit,
    select: {
      id: true,
      channel: true,
      template: true,
      attempts: true,
      error: true,
      updatedAt: true,
      appointment: {
        select: {
          id: true,
          startAt: true,
          guestName: true,
          client: { select: { firstName: true, lastName: true } },
        },
      },
    },
  })
}
