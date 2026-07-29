import { createHash, randomBytes } from 'node:crypto'
import { prisma } from '@/lib/db/client'

/**
 * Liens de connexion à usage unique.
 *
 * Écrits à la main, comme les sessions et le mot de passe : Auth.js n'a jamais
 * été installé sur ce projet, et l'ajouter pour ce seul usage introduirait une
 * dépendance là où quarante lignes suffisent (voir l'amendement de l'ADR-0001).
 *
 * Trois propriétés portent la sécurité :
 *
 *  1. **Le jeton est stocké haché.** Une lecture de la table — sauvegarde,
 *     injection SQL, accès prestataire — ne permet pas de forger un lien.
 *  2. **Usage unique.** Le jeton est supprimé à la consommation, avant même
 *     que la session soit créée : un lien intercepté dans une boîte de
 *     réception ne sert qu'une fois.
 *  3. **Durée de vie courte.** Un courriel reste lisible des années ; le lien,
 *     lui, expire en quinze minutes.
 */

/** Un lien de connexion vaut authentification : sa fenêtre reste étroite. */
const LIFETIME_MS = 15 * 60 * 1000

const TOKEN_BYTES = 32

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

/** Normalise une adresse pour la comparaison et le stockage. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}

/**
 * Crée un lien de connexion et renvoie le jeton en clair.
 *
 * Le clair n'existe qu'ici et dans le courriel envoyé.
 */
export async function createMagicLinkToken(email: string): Promise<string> {
  const identifier = normalizeEmail(email)
  const token = randomBytes(TOKEN_BYTES).toString('base64url')

  // Les demandes précédentes sont invalidées : recevoir un nouveau lien doit
  // rendre les anciens inopérants, sans quoi un lien ancien resterait
  // utilisable après un changement d'avis.
  await prisma.verificationToken.deleteMany({ where: { identifier } })

  await prisma.verificationToken.create({
    data: {
      identifier,
      token: hashToken(token),
      expires: new Date(Date.now() + LIFETIME_MS),
    },
  })

  return token
}

/**
 * Consomme un jeton et renvoie l'adresse associée.
 *
 * La suppression précède le retour : même si l'appelant échoue ensuite, le
 * jeton ne peut plus resservir.
 *
 * @returns l'adresse, ou `null` si le jeton est inconnu, expiré ou déjà utilisé.
 */
export async function consumeMagicLinkToken(token: string): Promise<string | null> {
  if (!token) return null

  const record = await prisma.verificationToken.findUnique({
    where: { token: hashToken(token) },
    select: { identifier: true, expires: true },
  })

  if (!record) return null

  // C'est la suppression, et non la lecture, qui départage : deux appels
  // concurrents lisent tous deux la ligne, mais un seul la supprime
  // effectivement. Sans ce contrôle du nombre de lignes retirées, un lien
  // intercepté ouvrirait deux sessions au lieu d'une.
  const { count } = await prisma.verificationToken.deleteMany({
    where: { token: hashToken(token) },
  })

  if (count === 0) return null

  if (record.expires.getTime() <= Date.now()) {
    return null
  }

  return record.identifier
}

/** Purge les jetons expirés. Appelée par le job de purge quotidien. */
export async function purgeExpiredTokens(now = new Date()): Promise<number> {
  const { count } = await prisma.verificationToken.deleteMany({
    where: { expires: { lt: now } },
  })
  return count
}
