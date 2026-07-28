import { hash, verify } from '@node-rs/argon2'
import { MIN_PASSWORD_LENGTH } from './constants'

/**
 * Hachage des mots de passe.
 *
 * Argon2id : résistant aux attaques par GPU comme par canaux auxiliaires,
 * recommandé par l'OWASP. Les paramètres suivent leur configuration de
 * référence — 19 Mio de mémoire, 2 passes, parallélisme 1.
 *
 * ⚠️ Module natif : utilisable côté Node uniquement, jamais dans le middleware
 * Next.js, qui s'exécute sur le runtime Edge.
 */

const ARGON2_OPTIONS = {
  memoryCost: 19456, // 19 Mio
  timeCost: 2,
  parallelism: 1,
} as const

export { MIN_PASSWORD_LENGTH } from './constants'

export async function hashPassword(plain: string): Promise<string> {
  if (plain.length < MIN_PASSWORD_LENGTH) {
    throw new Error(
      `Le mot de passe doit contenir au moins ${MIN_PASSWORD_LENGTH} caractères.`,
    )
  }
  return hash(plain, ARGON2_OPTIONS)
}

/**
 * Vérifie un mot de passe contre son empreinte.
 *
 * Ne lève jamais : une empreinte corrompue ou d'un format inconnu vaut échec de
 * vérification, pas erreur serveur. Sans cela, une donnée abîmée en base
 * exposerait une trace d'exécution à l'utilisateur.
 */
export async function verifyPassword(hashed: string, plain: string): Promise<boolean> {
  try {
    return await verify(hashed, plain, ARGON2_OPTIONS)
  } catch {
    return false
  }
}

/**
 * Empreinte factice, utilisée quand aucun compte ne correspond à l'adresse
 * saisie.
 *
 * Sans elle, une adresse inconnue répondrait bien plus vite qu'une adresse
 * connue : l'écart de temps permettrait d'énumérer les comptes existants. On
 * effectue donc une vérification dans tous les cas.
 */
export const DUMMY_HASH =
  '$argon2id$v=19$m=19456,t=2,p=1$c29tZXNhbHRzb21lc2FsdA$JLm5Ln5cQZ0PjLrEHJ5jZ2vP0jXqZKl4dQxHqYzKZ8Y'
