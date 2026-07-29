'use server'

import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { currentActor, landingPath } from '@/lib/auth/actor'
import { buildMagicLinkEmail, sendAuthEmail } from '@/features/notifications/authEmails'
import {
  consumeMagicLinkToken,
  createMagicLinkToken,
  normalizeEmail,
} from '@/lib/auth/magicLink'
import { DUMMY_HASH, hashPassword, verifyPassword } from '@/lib/auth/password'
import { safeRedirect } from '@/lib/auth/safeRedirect'
import { loginSchema, registerSchema } from '@/lib/auth/schemas'
import {
  clearSessionCookie,
  createSession,
  readSessionCookie,
  revokeSession,
  setSessionCookie,
} from '@/lib/auth/session'
import { prisma } from '@/lib/db/client'
import { RULES, callerKey, consume, reset } from '@/lib/rateLimit'

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

export type ActionState = { error: string | null; sent?: boolean }

/** Message unique : ne distingue pas « compte inconnu » de « mot de passe faux ». */
const INVALID_CREDENTIALS = 'Adresse électronique ou mot de passe incorrect.'

/** Message unique quand le quota est épuisé, sans révéler le compte visé. */
const TOO_MANY_ATTEMPTS = 'Trop de tentatives. Réessayez dans quelques minutes.'

export async function login(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  // Le quota est consommé avant toute lecture en base : un attaquant ne doit
  // pas pouvoir parcourir une liste de mots de passe.
  const key = callerKey(await headers(), 'login')
  if (!consume(key, RULES.login).allowed) {
    return { error: TOO_MANY_ATTEMPTS }
  }

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

  // Connexion réussie : le compteur repart à zéro, une faute de frappe ne doit
  // pas pénaliser durablement.
  reset(key)

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
  if (!consume(callerKey(await headers(), 'register'), RULES.register).allowed) {
    return { error: TOO_MANY_ATTEMPTS }
  }

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

/**
 * Demande un lien de connexion.
 *
 * La réponse est **toujours** la même, que l'adresse existe ou non : distinguer
 * les deux cas permettrait d'énumérer les comptes.
 */
export async function requestMagicLink(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const email = normalizeEmail(String(formData.get('email') ?? ''))

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { error: 'Adresse électronique invalide.' }
  }

  // Quota partagé avec la connexion par mot de passe : sans lui, cette route
  // deviendrait un moyen d'inonder une boîte de réception.
  if (!consume(callerKey(await headers(), 'login'), RULES.login).allowed) {
    return { error: TOO_MANY_ATTEMPTS }
  }

  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, deletedAt: true },
  })

  // Un compte anonymisé ne reçoit rien, mais le message reste identique.
  if (user && user.deletedAt === null) {
    const token = await createMagicLinkToken(email)
    await sendAuthEmail(buildMagicLinkEmail(email, token))
  }

  return { error: null, sent: true }
}

/**
 * Consomme un lien de connexion et ouvre une session.
 *
 * Rend le jeton de session plutôt que de poser le cookie : l'appelant est un
 * route handler, et un cookie posé via `cookies()` n'est pas attaché à une
 * réponse de redirection construite à la main. C'est donc à lui de l'écrire
 * sur la réponse.
 *
 * @returns le jeton et la destination, ou `null` si le lien est invalide.
 */
export async function consumeMagicLink(
  token: string,
): Promise<{ sessionToken: string; destination: string } | null> {
  const email = await consumeMagicLinkToken(token)
  if (!email) return null

  const user = await prisma.user.findUnique({
    where: { email },
    select: {
      id: true,
      deletedAt: true,
      role: true,
      memberships: {
        select: { salonId: true, id: true, role: true, isActive: true },
      },
    },
  })

  if (!user || user.deletedAt !== null) return null

  return {
    sessionToken: await createSession(user.id),
    // L'appartenance est lue ici : `currentActor` s'appuie sur le cookie, qui
    // n'existe pas encore à ce stade.
    destination: landingPath({
      userId: user.id,
      role: user.role,
      memberships: user.memberships.map((membership) => ({
        salonId: membership.salonId,
        memberId: membership.id,
        role: membership.role,
        isActive: membership.isActive,
      })),
    }),
  }
}
