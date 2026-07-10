/**
 * Cache court des créneaux publics (ADR-0003).
 *
 * Une fiche salon très consultée déclencherait autant de calculs que de
 * visiteurs, pour un résultat identique. Une rétention de quelques dizaines de
 * secondes absorbe ces rafales sans jamais afficher un créneau réservé depuis
 * longtemps.
 *
 * ⚠️ Cache **en mémoire du processus**. En déploiement multi-instances, chaque
 * instance a le sien : deux visiteurs peuvent voir des états décalés de
 * quelques secondes. C'est acceptable ici — la réservation elle-même est
 * protégée par la contrainte d'exclusion en base (ADR-0004), qui refuse un
 * créneau déjà pris quoi qu'ait affiché le cache. Si l'écart devenait gênant,
 * la réponse serait un cache partagé, pas un allongement de la rétention.
 *
 * Les agendas professionnels ne passent **jamais** par ce cache : un gérant
 * doit voir l'état réel de son salon.
 */

const DEFAULT_TTL_MS = 45_000
const MAX_ENTRIES = 500

type Entry<T> = { value: T; expiresAt: number }

const store = new Map<string, Entry<unknown>>()

/** Clé de cache d'une requête de disponibilité. */
export function availabilityCacheKey(input: {
  salonId: string
  serviceIds: string[]
  memberId: string | null
  from: Date
  to: Date
}): string {
  // Les prestations sont triées : le même panier dans un ordre différent doit
  // donner la même clé.
  const services = [...input.serviceIds].sort().join(',')
  return [
    input.salonId,
    services,
    input.memberId ?? 'ANY',
    input.from.toISOString(),
    input.to.toISOString(),
  ].join('|')
}

export function readCache<T>(key: string, now = Date.now()): T | undefined {
  const entry = store.get(key)
  if (!entry) return undefined

  if (entry.expiresAt <= now) {
    store.delete(key)
    return undefined
  }
  return entry.value as T
}

export function writeCache<T>(key: string, value: T, ttlMs = DEFAULT_TTL_MS): void {
  // Éviction naïve du plus ancien inséré : les Map JavaScript conservent
  // l'ordre d'insertion. Suffisant pour borner la mémoire à cette échelle.
  if (store.size >= MAX_ENTRIES) {
    const oldest = store.keys().next()
    if (!oldest.done) {
      store.delete(oldest.value)
    }
  }
  store.set(key, { value, expiresAt: Date.now() + ttlMs })
}

/**
 * Invalide toutes les entrées d'un salon.
 *
 * À appeler après **toute** écriture affectant les disponibilités : rendez-vous
 * créé, déplacé ou annulé, horaires modifiés, congé posé, prestation mise à
 * jour. Un oubli laisse afficher un créneau déjà pris jusqu'à l'expiration.
 */
export function invalidateSalon(salonId: string): void {
  for (const key of store.keys()) {
    if (key.startsWith(`${salonId}|`)) {
      store.delete(key)
    }
  }
}

/** Vide entièrement le cache. Réservé aux tests. */
export function clearCache(): void {
  store.clear()
}

/** Nombre d'entrées vivantes. Réservé aux tests et à l'observabilité. */
export function cacheSize(): number {
  return store.size
}
