import { describe, expect, it } from 'vitest'
import { phoneSchema, profileSchema } from '@/features/account/profile'

/**
 * Normalisation du téléphone.
 *
 * Twilio n'accepte que le format E.164. Refuser une saisie française usuelle
 * reviendrait à rendre les SMS inaccessibles à la plupart des clients — c'était
 * exactement la situation avant l'ajout de cet écran.
 */

describe('phoneSchema', () => {
  it('should convert a French national number to E.164', () => {
    expect(phoneSchema.parse('0612345678')).toBe('+33612345678')
  })

  it('should ignore usual separators when the number is spaced out', () => {
    expect(phoneSchema.parse('06 12 34 56 78')).toBe('+33612345678')
    expect(phoneSchema.parse('06.12.34.56.78')).toBe('+33612345678')
    expect(phoneSchema.parse('06-12-34-56-78')).toBe('+33612345678')
  })

  it('should keep an international number untouched when already in E.164', () => {
    expect(phoneSchema.parse('+33612345678')).toBe('+33612345678')
    expect(phoneSchema.parse('+441632960961')).toBe('+441632960961')
  })

  it('should accept a landline when it starts with a French area code', () => {
    expect(phoneSchema.parse('0478000000')).toBe('+33478000000')
  })

  it('should reject a number that is too short', () => {
    expect(() => phoneSchema.parse('0612')).toThrow()
  })

  it('should reject letters when the field is filled with text', () => {
    expect(() => phoneSchema.parse('appelez-moi')).toThrow()
  })

  it('should reject a national number starting with a double zero', () => {
    // `00` est un préfixe international, pas un indicatif : le convertir en
    // `+330…` produirait un numéro invalide chez l'opérateur.
    expect(() => phoneSchema.parse('0012345678')).toThrow()
  })
})

describe('profileSchema', () => {
  it('should accept an empty phone when the account only uses email', () => {
    const parsed = profileSchema.parse({
      firstName: 'Camille',
      lastName: 'Testeuse',
      phone: '',
    })

    expect(parsed.phone).toBe('')
  })

  it('should trim the name when it carries surrounding spaces', () => {
    const parsed = profileSchema.parse({
      firstName: '  Camille  ',
      lastName: 'Testeuse',
      phone: '',
    })

    expect(parsed.firstName).toBe('Camille')
  })

  it('should reject an empty first name when the field is blank', () => {
    expect(() =>
      profileSchema.parse({ firstName: '  ', lastName: 'Testeuse', phone: '' }),
    ).toThrow('Prénom requis')
  })

  it('should normalise the phone when a valid number is given', () => {
    const parsed = profileSchema.parse({
      firstName: 'Camille',
      lastName: 'Testeuse',
      phone: '06 12 34 56 78',
    })

    expect(parsed.phone).toBe('+33612345678')
  })
})
