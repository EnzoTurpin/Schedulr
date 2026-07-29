import { z } from 'zod'
import { MIN_PASSWORD_LENGTH } from '@/lib/auth/constants'
import { DUMMY_HASH, hashPassword, verifyPassword } from '@/lib/auth/password'
import { revokeAllSessions } from '@/lib/auth/session'
import type { Actor } from '@/lib/authz/types'
import { prisma } from '@/lib/db/client'

/**
 * Sécurité du compte : mot de passe et sessions.
 *
 * Un compte compromis n'avait aucun recours : ni changement de mot de passe,
 * ni moyen de fermer les sessions ouvertes ailleurs.
 */

export class InvalidPasswordError extends Error {
  constructor() {
    super('Mot de passe actuel incorrect.')
    this.name = 'InvalidPasswordError'
  }
}

export const passwordChangeSchema = z.object({
  currentPassword: z.string().min(1, 'Mot de passe actuel requis'),
  newPassword: z
    .string()
    .min(
      MIN_PASSWORD_LENGTH,
      `Le mot de passe doit contenir au moins ${MIN_PASSWORD_LENGTH} caractères`,
    )
    .max(200, 'Mot de passe trop long'),
})

export type PasswordChangeInput = z.infer<typeof passwordChangeSchema>

/**
 * Change le mot de passe et ferme toutes les autres sessions.
 *
 * La révocation est le point essentiel : changer son mot de passe après une
 * compromission ne sert à rien si la session de l'intrus reste ouverte.
 *
 * @returns le nombre de sessions fermées, la session courante comprise.
 * @throws {InvalidPasswordError} le mot de passe actuel ne correspond pas.
 */
export async function changePassword(
  actor: Actor,
  input: PasswordChangeInput,
): Promise<number> {
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: actor.userId },
    select: { passwordHash: true },
  })

  // Vérification même sans mot de passe enregistré — un compte créé par lien
  // magique n'en a pas —, pour que le temps de réponse ne le trahisse pas.
  const isValid = await verifyPassword(
    user.passwordHash ?? DUMMY_HASH,
    input.currentPassword,
  )
  if (!user.passwordHash || !isValid) throw new InvalidPasswordError()

  await prisma.user.update({
    where: { id: actor.userId },
    data: { passwordHash: await hashPassword(input.newPassword) },
  })

  return revokeAllSessions(actor.userId)
}

/** Ferme toutes les sessions du compte, y compris celle qui le demande. */
export async function signOutEverywhere(actor: Actor): Promise<number> {
  return revokeAllSessions(actor.userId)
}

/** Nombre de sessions ouvertes et non expirées. */
export async function countActiveSessions(actor: Actor): Promise<number> {
  return prisma.session.count({
    where: { userId: actor.userId, expires: { gt: new Date() } },
  })
}
