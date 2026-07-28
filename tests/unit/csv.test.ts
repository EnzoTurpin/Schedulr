import { describe, expect, it } from 'vitest'
import { csvAmount, escapeCell, toCsv } from '@/lib/csv'

/**
 * Génération de CSV.
 *
 * L'enjeu principal n'est pas cosmétique : une cellule mal échappée exécute du
 * code dans le tableur du gérant.
 */

describe('escapeCell', () => {
  it('should leave an ordinary value untouched', () => {
    expect(escapeCell('Coupe femme')).toBe('Coupe femme')
  })

  it('should return an empty string for null or undefined', () => {
    expect(escapeCell(null)).toBe('')
    expect(escapeCell(undefined)).toBe('')
  })

  it('should quote a value containing the separator', () => {
    expect(escapeCell('Lyon; Rhône')).toBe('"Lyon; Rhône"')
  })

  it('should double the inner quotes', () => {
    expect(escapeCell('Salon "Le Chic"')).toBe('"Salon ""Le Chic"""')
  })

  it('should quote a multi-line value', () => {
    expect(escapeCell('ligne 1\nligne 2')).toBe('"ligne 1\nligne 2"')
  })

  describe('injection de formule', () => {
    it('should neutralise a cell starting with an equals sign', () => {
      // Sans préfixe, le tableur exécuterait cette formule à l'ouverture.
      expect(escapeCell('=1+1')).toBe("'=1+1")
    })

    it('should neutralise the classic command injection payload', () => {
      const payload = "=cmd|'/c calc'!A1"

      expect(escapeCell(payload).startsWith("'")).toBe(true)
    })

    it('should neutralise plus, minus and at signs', () => {
      expect(escapeCell('+1')).toBe("'+1")
      expect(escapeCell('-1')).toBe("'-1")
      expect(escapeCell('@SUM(A1)')).toBe("'@SUM(A1)")
    })

    it('should neutralise a leading tab', () => {
      expect(escapeCell('\t=1+1').startsWith("'")).toBe(true)
    })

    it('should not alter a negative number written as a number', () => {
      // Le type numérique n'est pas une saisie utilisateur : il est converti
      // puis préfixé comme le reste, ce qui reste lisible dans le tableur.
      expect(escapeCell(-42)).toBe("'-42")
    })
  })
})

describe('csvAmount', () => {
  it('should use a comma as decimal separator', () => {
    expect(csvAmount(3500)).toBe('35,00')
  })

  it('should keep two decimals', () => {
    expect(csvAmount(4250)).toBe('42,50')
    expect(csvAmount(0)).toBe('0,00')
  })
})

describe('toCsv', () => {
  it('should join headers and rows with semicolons', () => {
    const csv = toCsv(['Nom', 'Prix'], [['Coupe', '35,00']])

    expect(csv).toContain('Nom;Prix')
    expect(csv).toContain('Coupe;35,00')
  })

  it('should start with a UTF-8 BOM', () => {
    // Sans lui, Excel lit le fichier en ANSI et les accents sont illisibles.
    expect(toCsv(['Été'], [])).toMatch(/^﻿/)
  })

  it('should use CRLF line endings', () => {
    const csv = toCsv(['a'], [['b']])

    expect(csv).toContain('\r\n')
  })

  it('should escape every cell of every row', () => {
    const csv = toCsv(['Client'], [['=HYPERLINK("http://x")']])

    expect(csv).toContain("'=HYPERLINK")
  })

  it('should handle an empty row set', () => {
    expect(toCsv(['a', 'b'], [])).toBe('﻿a;b\r\n')
  })
})
