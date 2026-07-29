import { z } from 'zod'
import { phoneSchema } from '@/features/account/profile'
import { MIN_PASSWORD_LENGTH } from './constants'

/**
 * Schémas de validation des formulaires d'authentification.
 *
 * Isolés des actions pour être testables sans base de données, et réutilisables
 * côté client pour la validation immédiate.
 */

const email = z
  .string()
  .trim()
  .toLowerCase()
  .min(1, 'Adresse électronique requise')
  .refine((value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value), {
    message: 'Adresse électronique invalide',
  })

export const loginSchema = z.object({
  email,
  // Aucune contrainte de longueur ici : refuser un mot de passe « trop court »
  // à la connexion renseignerait un attaquant sur la politique appliquée, et
  // la comparaison échouera de toute façon.
  password: z.string().min(1, 'Mot de passe requis'),
})

export const registerSchema = z.object({
  email,
  password: z
    .string()
    .min(
      MIN_PASSWORD_LENGTH,
      `Le mot de passe doit contenir au moins ${MIN_PASSWORD_LENGTH} caractères`,
    )
    // Longueur maximale : Argon2 accepte de très longues entrées, mais hacher
    // plusieurs mégaoctets à chaque tentative offrirait un levier de déni de
    // service.
    .max(200, 'Mot de passe trop long'),
  firstName: z.string().trim().min(1, 'Prénom requis').max(80),
  lastName: z.string().trim().min(1, 'Nom requis').max(80),
  // Facultatif : le demander sans l'exiger évite un second passage par le
  // profil à qui veut ses rappels par SMS.
  phone: z.union([z.literal(''), phoneSchema]).optional(),
})

export type LoginInput = z.infer<typeof loginSchema>
export type RegisterInput = z.infer<typeof registerSchema>
