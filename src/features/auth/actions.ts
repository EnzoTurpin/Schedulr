'use server'

import { redirect } from 'next/navigation'
import { currentActor, landingPath } from '@/lib/auth/actor'
import { DUMMY_HASH, hashPassword, verifyPassword } from '@/lib/auth/password'
import { loginSchema, registerSchema } from '@/lib/auth/schemas'
import {
  clearSessionCookie,
  createSession,
  readSessionCookie,
  revokeSession,
  setSessionCookie,
} from '@/lib/auth/session'
import { prisma } from '@/lib/db/client'

/**
 * Actions d'authentification.
 *
 * Deux principes gouvernent ce fichier :
 *
 *  1. **Ne jamais révéler si une adresse est connue.** Message d'erreur unique,
 *     et vérification d'un mot de passe factice quand aucun compte ne
 *     correspond, pour que le temps de réponse ne trahisse pas l'existence du
 *     compte.
 *  2. **Ne jamais journaliser d'adresse ni de mot de passe** (CLAUDE.md).
 */

export type ActionState = { error: string | null }

/**
 * Valide la destination de retour après connexion.
 *
 * Seuls les chemins internes sont acceptés : une URL absolue permettrait une
 * redirection ouverte vers un site tiers, technique classique d'hameçonnage.
 * `//evil.com` est un chemin relatif au protocole et doit être refusé aussi.
 */
function safeRedirect(target: FormDataEntryValue | null): string | null {
  if (typeof target !== 'string' || target.length === 0) return null
  if (!target.startsWith('/') || target.startsWith('//')) return null
  return target
}

/** Message unique : ne distingue pas « compte inconnu » de « mot de passe faux ». */
const INVALID_CREDENTIALS = 'Adresse électronique ou mot de passe incorrect.'

export async function login(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = loginSchema.safeParse({
    email: formData.get('email'),
    password: formData.get('password'),
  })

  if (!parsed.success) {
    return { error: INVALID_CREDENTIALS }
  }

  const user = await prisma.user.findUnique({
    where: { email: parsed.data.email },
    select: { id: true, passwordHash: true, deletedAt: true },
  })

  // Vérification systématique, y compris sans compte : c'est ce qui égalise le
  // temps de réponse et empêche l'énumération des comptes existants.
  const isValid = await verifyPassword(
    user?.passwordHash ?? DUMMY_HASH,
    parsed.data.password,
  )

  if (!user || !user.passwordHash || user.deletedAt !== null || !isValid) {
    return { error: INVALID_CREDENTIALS }
  }

  const token = await createSession(user.id)
  await setSessionCookie(token)

  const suite = safeRedirect(formData.get('suite'))
  if (suite) {
    redirect(suite)
  }

  const actor = await currentActor()
  redirect(actor ? landingPath(actor) : '/mon-compte')
}

export async function register(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = registerSchema.safeParse({
    email: formData.get('email'),
    password: formData.get('password'),
    firstName: formData.get('firstName'),
    lastName: formData.get('lastName'),
  })

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Formulaire invalide.' }
  }

  const existing = await prisma.user.findUnique({
    where: { email: parsed.data.email },
    select: { id: true },
  })

  if (existing) {
    // Message volontairement identique à un succès du point de vue de
    // l'attaquant : on n'annonce pas que l'adresse est déjà prise. Le
    // propriétaire légitime de l'adresse recevra un courriel l'en informant
    // lorsque la phase 6 sera livrée.
    return {
      error:
        'Si cette adresse n’est pas déjà utilisée, votre compte a été créé. ' +
        'Essayez de vous connecter.',
    }
  }

  const user = await prisma.user.create({
    data: {
      email: parsed.data.email,
      passwordHash: await hashPassword(parsed.data.password),
      firstName: parsed.data.firstName,
      lastName: parsed.data.lastName,
    },
    select: { id: true },
  })

  const token = await createSession(user.id)
  await setSessionCookie(token)

  redirect('/mon-compte')
}

export async function logout(): Promise<never> {
  const token = await readSessionCookie()
  if (token) {
    await revokeSession(token)
  }
  await clearSessionCookie()
  redirect('/connexion')
}
