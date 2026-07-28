/**
 * Génération de fichiers CSV.
 *
 * Deux protections que l'échappement naïf oublie :
 *
 *  1. **L'injection de formule.** Un tableur interprète toute cellule
 *     commençant par `=`, `+`, `-` ou `@` comme une formule. Un client nommé
 *     `=cmd|'/c calc'!A1` exécuterait du code à l'ouverture du fichier par le
 *     gérant. Ces cellules sont préfixées d'une apostrophe.
 *  2. **Le séparateur décimal.** Excel en configuration française attend `;`
 *     comme séparateur de colonnes et `,` comme séparateur décimal. Un fichier
 *     en `,` s'ouvre en une seule colonne illisible.
 */

/** Caractères qu'un tableur interprète comme le début d'une formule. */
const FORMULA_PREFIXES = ['=', '+', '-', '@', '\t', '\r']

const SEPARATOR = ';'

/** Échappe une cellule : neutralise les formules, protège les guillemets. */
export function escapeCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return ''

  let cell = String(value)

  // Neutralise l'interprétation en formule sans altérer la valeur lue.
  if (FORMULA_PREFIXES.some((prefix) => cell.startsWith(prefix))) {
    cell = `'${cell}`
  }

  // Guillemets doublés, cellule encadrée si elle contient un caractère spécial.
  if (cell.includes('"') || cell.includes(SEPARATOR) || /[\n\r]/.test(cell)) {
    return `"${cell.replace(/"/g, '""')}"`
  }

  return cell
}

/** Montant en centimes → « 35,00 », séparateur décimal français. */
export function csvAmount(cents: number): string {
  return (cents / 100).toFixed(2).replace('.', ',')
}

/**
 * Assemble un CSV.
 *
 * Le BOM UTF-8 en tête est indispensable : sans lui, Excel lit le fichier en
 * ANSI et les accents deviennent illisibles.
 */
export function toCsv(headers: string[], rows: (string | number | null)[][]): string {
  const lines = [
    headers.map(escapeCell).join(SEPARATOR),
    ...rows.map((row) => row.map(escapeCell).join(SEPARATOR)),
  ]

  return `﻿${lines.join('\r\n')}\r\n`
}

/** En-têtes HTTP d'un téléchargement CSV. */
export function csvHeaders(filename: string): HeadersInit {
  return {
    'Content-Type': 'text/csv; charset=utf-8',
    // Le nom est encadré : il peut contenir des espaces.
    'Content-Disposition': `attachment; filename="${filename.replace(/"/g, '')}"`,
    // Un export contient des données personnelles : jamais de cache partagé.
    'Cache-Control': 'no-store',
  }
}
