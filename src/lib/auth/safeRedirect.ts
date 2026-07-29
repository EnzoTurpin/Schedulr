/**
 * Validation des destinations de redirection après connexion.
 *
 * La destination vient du client — paramètre d'URL puis champ de formulaire.
 * Sans contrôle, notre propre page de connexion redirigerait vers un site
 * tiers : c'est le schéma classique de l'hameçonnage par redirection ouverte,
 * d'autant plus efficace qu'il part d'un lien authentiquement nôtre.
 *
 * Seuls les chemins internes sont acceptés. Un chemin peut porter une chaîne
 * de requête — une invitation ne vit que par son jeton (voir
 * `src/app/(app)/invitation/page.tsx`).
 */
export function safeRedirect(target: unknown): string | null {
  if (typeof target !== 'string' || target.length === 0) return null

  // `//` et `/\` amorcent l'un et l'autre une URL absolue pour les navigateurs :
  // `//evil.example` et `/\evil.example` mènent tous deux hors du site.
  if (!target.startsWith('/') || target.startsWith('//') || target.startsWith('/\\')) {
    return null
  }

  return target
}
