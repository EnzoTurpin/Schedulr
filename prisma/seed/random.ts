/**
 * Générateur pseudo-aléatoire à graine fixe.
 *
 * Le CLAUDE.md interdit les tests dépendant d'un aléatoire non initialisé, et
 * la même exigence vaut pour le seed : deux exécutions doivent produire le même
 * jeu de données, sans quoi une anomalie observée en développement devient
 * impossible à reproduire.
 *
 * Algorithme mulberry32 : court, rapide, suffisant pour du jeu de test — il
 * n'a aucune propriété cryptographique et ne doit jamais servir à produire un
 * jeton ou un secret.
 */
export function createRandom(seed: number) {
  let state = seed >>> 0

  /** Flottant dans [0, 1). */
  function next(): number {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }

  /** Entier dans [min, max]. */
  function int(min: number, max: number): number {
    return min + Math.floor(next() * (max - min + 1))
  }

  /** Élément d'un tableau non vide. */
  function pick<T>(items: readonly T[]): T {
    const item = items[int(0, items.length - 1)]
    if (item === undefined) {
      throw new Error('pick() appelé sur un tableau vide')
    }
    return item
  }

  /** Copie mélangée (Fisher-Yates). */
  function shuffle<T>(items: readonly T[]): T[] {
    const copy = [...items]
    for (let i = copy.length - 1; i > 0; i--) {
      const j = int(0, i)
      const a = copy[i]
      const b = copy[j]
      if (a !== undefined && b !== undefined) {
        copy[i] = b
        copy[j] = a
      }
    }
    return copy
  }

  return { next, int, pick, shuffle }
}
