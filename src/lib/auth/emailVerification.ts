import { createHash, randomBytes } from 'node:crypto'
import { prisma } from '@/lib/db/client'
import { normalizeEmail } from './magicLink'

/**
 * Vérification de l'adresse électronique.
 *
 * Sans elle, n'importe qui peut créer un compte au nom d'un tiers et recevoir
 * les notifications de ses rendez-vous. Le compte fonctionne malgré tout tant
 * que l'adresse n'est pas confirmée : **seules les notifications sont
 * suspendues**. Bloquer la connexion enfermerait définitivement quiconque a
 * saisi son adresse de travers, sans aucun recours.
 *
 * Le jeton porte un usage explicite (`EMAIL_VERIFICATION`) : la table est
 * partagée avec les liens de connexion, et sans cette distinction un lien de
 * vérification ouvrirait une session.
 */

/** Un courriel peut attendre : 24 h, contre 15 minutes pour une connexion. */
const LIFETIME_MS = 24 * 60 * 60 * 1000

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

/** Crée un jeton de vérification et renvoie sa valeur en clair. */
export async function createVerificationToken(email: string): Promise<string> {
  const identifier = normalizeEmail(email)
  const token = randomBytes(32).toString('base64url')

  await prisma.verificationToken.deleteMany({
    where: { identifier, purpose: 'EMAIL_VERIFICATION' },
  })

  await prisma.verificationToken.create({
    data: {
      identifier,
      token: hashToken(token),
      purpose: 'EMAIL_VERIFICATION',
      expires: new Date(Date.now() + LIFETIME_MS),
    },
  })

  return token
}

/**
 * Consomme un jeton et marque l'adresse comme vérifiée.
 *
 * @returns l'adresse vérifiée, ou `null` si le jeton est invalide ou expiré.
 */
export async function confirmEmail(token: string): Promise<string | null> {
  if (!token) return null

  const record = await prisma.verificationToken.findUnique({
    where: { token: hashToken(token) },
    select: { identifier: true, expires: true, purpose: true },
  })

  if (!record || record.purpose !== 'EMAIL_VERIFICATION') return null

  // La suppression départage deux appels concurrents : c'est elle, et non la
  // lecture, qui ne peut réussir qu'une fois.
  const { count } = await prisma.verificationToken.deleteMany({
    where: { token: hashToken(token), purpose: 'EMAIL_VERIFICATION' },
  })
  if (count === 0) return null

  if (record.expires.getTime() <= Date.now()) return null

  // `updateMany` plutôt que `update` : un compte supprimé entre-temps ne doit
  // pas faire échouer la confirmation par une exception.
  await prisma.user.updateMany({
    where: { email: record.identifier, deletedAt: null },
    data: { emailVerified: new Date() },
  })

  return record.identifier
}
