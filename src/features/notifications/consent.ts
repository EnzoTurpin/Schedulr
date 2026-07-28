import type { ConsentType } from '@/generated/prisma'
import { prisma } from '@/lib/db/client'
import type { Actor } from '@/lib/authz/types'

/**
 * Registre des consentements.
 *
 * Historisé plutôt qu'écrasé : le RGPD demande de pouvoir prouver *quand* et
 * *comment* un consentement a été donné. Un booléen mis à jour perdrait cette
 * preuve, et un client contestant un envoi ne pourrait pas être départagé.
 */

/** État courant : la décision la plus récente pour chaque type. */
export async function getConsents(userId: string): Promise<Record<ConsentType, boolean>> {
  const records = await prisma.consentRecord.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    select: { type: true, granted: true },
  })

  const state: Record<ConsentType, boolean> = {
    TRANSACTIONAL_SMS: false,
    MARKETING_EMAIL: false,
    MARKETING_SMS: false,
  }

  // Le tri décroissant garantit que la première occurrence rencontrée est la
  // plus récente : les suivantes sont l'historique.
  const seen = new Set<ConsentType>()
  for (const record of records) {
    if (seen.has(record.type)) continue
    seen.add(record.type)
    state[record.type] = record.granted
  }

  return state
}

/**
 * Enregistre une décision.
 *
 * Toujours une insertion, jamais une mise à jour : chaque changement d'avis
 * laisse une trace datée.
 */
export async function recordConsent(
  actor: Actor,
  type: ConsentType,
  granted: boolean,
  source: string,
): Promise<void> {
  await prisma.consentRecord.create({
    data: { userId: actor.userId, type, granted, source },
  })
}

/** Le client accepte-t-il les SMS transactionnels ? */
export async function hasSmsConsent(userId: string): Promise<boolean> {
  const latest = await prisma.consentRecord.findFirst({
    where: { userId, type: 'TRANSACTIONAL_SMS' },
    orderBy: { createdAt: 'desc' },
    select: { granted: true },
  })

  // Absence de trace = refus. Le consentement est un acte positif.
  return latest?.granted ?? false
}
