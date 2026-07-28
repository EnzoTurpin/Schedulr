import { describe, expect, it } from 'vitest'
import {
  DUMMY_HASH,
  MIN_PASSWORD_LENGTH,
  hashPassword,
  verifyPassword,
} from '@/lib/auth/password'

describe('hachage des mots de passe', () => {
  it('should produce an argon2id hash', async () => {
    const hash = await hashPassword('un-mot-de-passe-valide')

    expect(hash).toMatch(/^\$argon2id\$/)
  })

  it('should produce a different hash for the same password', async () => {
    // Le sel est aléatoire : deux comptes partageant le même mot de passe ne
    // doivent pas être reconnaissables par comparaison des empreintes.
    const first = await hashPassword('un-mot-de-passe-valide')
    const second = await hashPassword('un-mot-de-passe-valide')

    expect(first).not.toBe(second)
  })

  it('should reject a password shorter than the minimum length', async () => {
    const tooShort = 'a'.repeat(MIN_PASSWORD_LENGTH - 1)

    await expect(hashPassword(tooShort)).rejects.toThrow(/au moins/)
  })

  it('should verify a correct password', async () => {
    const hash = await hashPassword('un-mot-de-passe-valide')

    await expect(verifyPassword(hash, 'un-mot-de-passe-valide')).resolves.toBe(true)
  })

  it('should reject an incorrect password', async () => {
    const hash = await hashPassword('un-mot-de-passe-valide')

    await expect(verifyPassword(hash, 'un-autre-mot-de-passe')).resolves.toBe(false)
  })

  it('should return false rather than throw on a malformed hash', async () => {
    // Une empreinte abîmée en base ne doit pas produire une erreur serveur, qui
    // exposerait une trace d'exécution à l'utilisateur.
    await expect(verifyPassword('pas-une-empreinte', 'peu-importe')).resolves.toBe(false)
  })

  it('should return false when verifying against the dummy hash', async () => {
    // L'empreinte factice sert à égaliser le temps de réponse quand aucun
    // compte ne correspond : elle ne doit jamais valider un mot de passe.
    await expect(verifyPassword(DUMMY_HASH, 'peu-importe')).resolves.toBe(false)
  })
})
