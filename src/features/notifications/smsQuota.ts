import { prisma } from '@/lib/db/client'

/**
 * Plafond mensuel de SMS par salon.
 *
 * Chaque message est facturé. Sans plafond, un salon très fréquenté — ou une
 * boucle défectueuse — produirait une facture que personne ne verrait avant de
 * la recevoir.
 *
 * Le compteur se lit dans `NotificationLog`, qui porte déjà tous les envois :
 * pas de compteur parallèle à maintenir, donc pas de dérive possible entre les
 * deux.
 */

/** Premier instant du mois calendaire courant, en UTC. */
function startOfMonth(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
}

export type QuotaState = {
  used: number
  quota: number
  remaining: number
  exceeded: boolean
}

/** État du quota d'un salon pour le mois en cours. */
export async function getSmsQuota(
  salonId: string,
  now = new Date(),
): Promise<QuotaState> {
  const [salon, used] = await Promise.all([
    prisma.salon.findUnique({
      where: { id: salonId },
      select: { smsMonthlyQuota: true },
    }),
    // Les envois en échec ne sont pas facturés : seuls les SMS partis comptent.
    prisma.notificationLog.count({
      where: {
        salonId,
        channel: 'SMS',
        status: 'SENT',
        createdAt: { gte: startOfMonth(now) },
      },
    }),
  ])

  const quota = salon?.smsMonthlyQuota ?? 0

  return {
    used,
    quota,
    remaining: Math.max(0, quota - used),
    exceeded: used >= quota,
  }
}

/**
 * Le salon peut-il encore envoyer un SMS ce mois-ci ?
 *
 * Consulté avant chaque envoi. Le dépassement n'interrompt pas la
 * notification : le courriel part quand même, seul le SMS est supprimé.
 */
export async function canSendSms(salonId: string, now = new Date()): Promise<boolean> {
  return !(await getSmsQuota(salonId, now)).exceeded
}
