import { describe, expect, it } from 'vitest'
import { serializeJsonLd } from '@/lib/jsonLd'

/**
 * Sérialisation des données structurées.
 *
 * `JSON.stringify` seul laisse passer `</script>` : un nom de salon saisi par
 * un gérant malveillant s'exécuterait chez tout visiteur de la fiche publique.
 */

describe('serializeJsonLd', () => {
  it('should escape a closing script tag', () => {
    const payload = { name: '</script><script>alert(1)</script>' }

    const output = serializeJsonLd(payload)

    expect(output).not.toContain('</script>')
    expect(output).not.toContain('<script>')
  })

  it('should escape angle brackets and ampersands', () => {
    expect(serializeJsonLd({ v: '<' })).toContain('\\u003c')
    expect(serializeJsonLd({ v: '>' })).toContain('\\u003e')
    expect(serializeJsonLd({ v: '&' })).toContain('\\u0026')
  })

  it('should stay parseable and preserve the original value', () => {
    // L'échappement Unicode est ignoré du parseur HTML mais restitué par
    // JSON.parse : les moteurs de recherche lisent bien la valeur exacte.
    const payload = { name: 'Salon <Chic> & Co' }

    const parsed = JSON.parse(serializeJsonLd(payload))

    expect(parsed.name).toBe('Salon <Chic> & Co')
  })

  it('should handle nested structures', () => {
    const payload = {
      '@type': 'HairSalon',
      makesOffer: [{ name: '</script>injection' }],
    }

    const output = serializeJsonLd(payload)

    expect(output).not.toContain('</script>')
    expect(JSON.parse(output).makesOffer[0].name).toBe('</script>injection')
  })

  it('should leave ordinary content untouched once parsed', () => {
    const payload = { name: 'Salon Bellecour', city: 'Lyon' }

    expect(JSON.parse(serializeJsonLd(payload))).toEqual(payload)
  })
})
