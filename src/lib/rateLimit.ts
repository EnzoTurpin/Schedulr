/**
 * Limitation de débit.
 *
 * Protège l'authentification contre le bourrage d'identifiants et la
 * réservation contre l'inondation de créneaux.
 *
 * ⚠️ **Compteurs en mémoire du processus.** En déploiement multi-instances,
 * chaque instance a les siens : la limite effective est donc multipliée par le
 * nombre d'instances. C'est un compromis assumé pour la V1 — un magasin
 * partagé (Redis, Upstash) est la bonne réponse à l'échelle, mais il ajoute une
 * dépendance d'infrastructure qui n'a pas été tranchée. Le sujet est signalé
 * dans le CHANGELOG.
 *
 * Cette limitation reste utile en l'état : elle bloque un script naïf lancé
 * depuis une seule origine, cas de très loin le plus fréquent.
 */

type Bucket = { count: number; resetAt: number }

const buckets = new Map<string, Bucket>()

/** Purge périodique : sans elle, la table croîtrait indéfiniment. */
const MAX_BUCKETS = 10_000

export type RateLimitRule = {
  /** Nombre de tentatives autorisées par fenêtre. */
  limit: number
  /** Durée de la fenêtre, en millisecondes. */
  windowMs: number
}

export type RateLimitResult = {
  allowed: boolean
  remaining: number
  /** Instant auquel la fenêtre se réinitialise. */
  resetAt: number
}

/** Règles par usage. Les valeurs sont volontairement conservatrices. */
export const RULES = {
  /**
   * Connexion : cinq essais par quart d'heure et par adresse IP.
   *
   * Assez pour une faute de frappe répétée, trop peu pour parcourir une liste
   * de mots de passe.
   */
  login: { limit: 5, windowMs: 15 * 60_000 },

  /** Création de compte : limite l'inscription automatisée. */
  register: { limit: 3, windowMs: 60 * 60_000 },

  /** Réservation : un client honnête n'enchaîne pas dix rendez-vous par heure. */
  booking: { limit: 10, windowMs: 60 * 60_000 },
} as const satisfies Record<string, RateLimitRule>

/**
 * Consomme une unité de quota.
 *
 * @param key Identifiant de l'appelant : adresse IP, ou adresse IP + action.
 * @param now Injecté pour rendre les tests déterministes.
 */
export function consume(
  key: string,
  rule: RateLimitRule,
  now = Date.now(),
): RateLimitResult {
  // Éviction opportuniste des fenêtres expirées, pour borner la mémoire.
  if (buckets.size >= MAX_BUCKETS) {
    for (const [bucketKey, bucket] of buckets) {
      if (bucket.resetAt <= now) buckets.delete(bucketKey)
    }
  }

  const existing = buckets.get(key)

  if (!existing || existing.resetAt <= now) {
    const bucket = { count: 1, resetAt: now + rule.windowMs }
    buckets.set(key, bucket)
    return { allowed: true, remaining: rule.limit - 1, resetAt: bucket.resetAt }
  }

  if (existing.count >= rule.limit) {
    return { allowed: false, remaining: 0, resetAt: existing.resetAt }
  }

  existing.count++
  return {
    allowed: true,
    remaining: rule.limit - existing.count,
    resetAt: existing.resetAt,
  }
}

/** Remet un compteur à zéro. Utilisé après une connexion réussie. */
export function reset(key: string): void {
  buckets.delete(key)
}

/** Vide tous les compteurs. Réservé aux tests. */
export function clearRateLimits(): void {
  buckets.clear()
}

/**
 * Identifie l'appelant à partir des en-têtes de la requête.
 *
 * `x-forwarded-for` est renseigné par le proxy d'hébergement ; sa première
 * valeur est l'adresse d'origine. En développement, aucun proxy : on retombe
 * sur une clé unique, ce qui rend la limitation globale — sans conséquence
 * puisqu'un seul poste s'y connecte.
 */
export function callerKey(headers: Headers, scope: string): string {
  const forwarded = headers.get('x-forwarded-for')?.split(',')[0]?.trim()
  const ip = forwarded || headers.get('x-real-ip') || 'local'
  return `${scope}:${ip}`
}
