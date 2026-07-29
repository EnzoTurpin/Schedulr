/**
 * Sérialisation de données structurées destinées à une balise `<script>`.
 *
 * ⚠️ `JSON.stringify` **ne suffit pas**. Le parseur HTML termine une balise
 * `<script>` dès qu'il rencontre la séquence `</script` dans le flux, sans
 * considération pour le fait qu'elle se trouve à l'intérieur d'une chaîne
 * JSON. Un champ libre — nom de salon, description, biographie d'un coiffeur —
 * contenant `</script><script>…</script>` s'exécuterait donc chez tout
 * visiteur de la page.
 *
 * Les trois caractères sont réécrits en séquences d'échappement Unicode :
 * elles sont ignorées du parseur HTML mais restituées à l'identique par
 * `JSON.parse`, si bien que les moteurs de recherche lisent la valeur exacte.
 */
export function serializeJsonLd(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
}
