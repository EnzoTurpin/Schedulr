import { randomBytes, createHash, timingSafeEqual } from 'node:crypto'
import { cookies } from 'next/headers'
import { prisma } from '@/lib/db/client'
import { SESSION_COOKIE, SESSION_DURATION_DAYS } from './constants'

/**
 * Sessions persistées en base (ADR-0001).
 *
 * Auth.js v5 n'accepte pas les sessions en base avec un fournisseur par mot de
 * passe : ce module implémente donc le cycle de vie de session directement
 * (voir l'amendement de l'ADR-0001). Le modèle `Session` reste conforme au
 * contrat de l'adaptateur Prisma d'Auth.js, ce qui laisse la porte ouverte à
 * une fédération d'identité sans migration.
 *
 * Le jeton de session est stocké **haché** en base : une lecture de la table
 * (sauvegarde, injection SQL, accès d'un prestataire) ne permet pas d'usurper
 * une session.
 */

const TOKEN_BYTES = 32

export { SESSION_COOKIE } from './constants'

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

function expiryDate(): Date {
  return new Date(Date.now() + SESSION_DURATION_DAYS * 24 * 60 * 60 * 1000)
}

/**
 * Crée une session et renvoie le jeton en clair, à poser en cookie.
 * Le clair n'existe qu'ici et dans le cookie du navigateur.
 */
export async function createSession(userId: string): Promise<string> {
  const token = randomBytes(TOKEN_BYTES).toString('base64url')

  await prisma.session.create({
    data: {
      userId,
      sessionToken: hashToken(token),
      expires: expiryDate(),
    },
  })

  return token
}

/** Résout la session associée à un jeton, ou `null` si absente ou expirée. */
export async function resolveSession(token: string | undefined) {
  if (!token) {
    return null
  }

  const session = await prisma.session.findUnique({
    where: { sessionToken: hashToken(token) },
    include: {
      user: {
        include: {
          memberships: {
            select: { salonId: true, id: true, role: true, isActive: true },
          },
        },
      },
    },
  })

  if (!session) {
    return null
  }

  // Une session expirée est supprimée au passage : la table ne doit pas
  // accumuler indéfiniment des lignes mortes.
  if (session.expires.getTime() <= Date.now()) {
    await prisma.session.delete({ where: { id: session.id } }).catch(() => {
      // La suppression concurrente par une autre requête est sans conséquence.
    })
    return null
  }

  // Un compte anonymisé ne doit plus ouvrir de session.
  if (session.user.deletedAt !== null) {
    return null
  }

  return session
}

/** Révoque une session précise. Effet immédiat, c'est l'objet de l'ADR-0001. */
export async function revokeSession(token: string): Promise<void> {
  await prisma.session.delete({ where: { sessionToken: hashToken(token) } }).catch(() => {
    // Déjà révoquée : la déconnexion reste un succès.
  })
}

/**
 * Révoque toutes les sessions d'un compte.
 *
 * À appeler lors d'un changement de mot de passe et lors de la désactivation
 * d'un membre : c'est ce qui rend la révocation réellement immédiate.
 */
export async function revokeAllSessions(userId: string): Promise<number> {
  const { count } = await prisma.session.deleteMany({ where: { userId } })
  return count
}

/** Compare deux jetons sans fuite de temps. */
export function tokensMatch(a: string, b: string): boolean {
  const bufferA = Buffer.from(a)
  const bufferB = Buffer.from(b)
  if (bufferA.length !== bufferB.length) {
    return false
  }
  return timingSafeEqual(bufferA, bufferB)
}

// --- Cookie -----------------------------------------------------------------

export async function setSessionCookie(token: string): Promise<void> {
  const store = await cookies()
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    expires: expiryDate(),
  })
}

export async function clearSessionCookie(): Promise<void> {
  const store = await cookies()
  store.delete(SESSION_COOKIE)
}

export async function readSessionCookie(): Promise<string | undefined> {
  const store = await cookies()
  return store.get(SESSION_COOKIE)?.value
}
