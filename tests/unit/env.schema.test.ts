import { describe, expect, it } from 'vitest'
import { EnvValidationError, parseServerEnv, type RawEnv } from '@/lib/env.schema'

/**
 * Jeu de variables minimal et valide, dont chaque test dérive.
 * Passer `undefined` en surcharge simule une variable absente.
 */
function validEnv(overrides: RawEnv = {}): RawEnv {
  return {
    NODE_ENV: 'test',
    DATABASE_URL: 'postgresql://user:pass@localhost:5432/schedulr_test',
    AUTH_SECRET: 'a'.repeat(32),
    APP_URL: 'http://localhost:3000',
    ...overrides,
  }
}

describe('parseServerEnv', () => {
  it('should return the parsed environment when all required variables are valid', () => {
    // Arrange
    const raw = validEnv()

    // Act
    const env = parseServerEnv(raw)

    // Assert
    expect(env.DATABASE_URL).toBe('postgresql://user:pass@localhost:5432/schedulr_test')
    expect(env.NODE_ENV).toBe('test')
  })

  it('should default NODE_ENV to development when it is absent', () => {
    const raw = validEnv({ NODE_ENV: undefined })

    const env = parseServerEnv(raw)

    expect(env.NODE_ENV).toBe('development')
  })

  it('should throw when DATABASE_URL is missing', () => {
    const raw = validEnv({ DATABASE_URL: undefined })

    expect(() => parseServerEnv(raw)).toThrow(EnvValidationError)
  })

  it('should throw when DATABASE_URL is not a PostgreSQL URL', () => {
    const raw = validEnv({ DATABASE_URL: 'mysql://user:pass@localhost:3306/schedulr' })

    expect(() => parseServerEnv(raw)).toThrow(/URL PostgreSQL/)
  })

  it('should accept the postgres:// scheme as well as postgresql://', () => {
    const raw = validEnv({ DATABASE_URL: 'postgres://user:pass@localhost:5432/schedulr' })

    expect(() => parseServerEnv(raw)).not.toThrow()
  })

  it('should throw when AUTH_SECRET is shorter than 32 characters', () => {
    const raw = validEnv({ AUTH_SECRET: 'trop-court' })

    expect(() => parseServerEnv(raw)).toThrow(/32 caractères/)
  })

  it('should throw when APP_URL ends with a trailing slash', () => {
    const raw = validEnv({ APP_URL: 'https://schedulr.fr/' })

    expect(() => parseServerEnv(raw)).toThrow(/slash/)
  })

  it('should list every invalid variable in a single error', () => {
    const raw = validEnv({
      DATABASE_URL: undefined,
      AUTH_SECRET: 'court',
      APP_URL: 'https://schedulr.fr/',
    })

    try {
      parseServerEnv(raw)
      expect.unreachable('parseServerEnv aurait dû lever')
    } catch (error) {
      expect(error).toBeInstanceOf(EnvValidationError)
      expect((error as EnvValidationError).issues).toHaveLength(3)
    }
  })

  describe('coupe-circuit des notifications', () => {
    it('should disable notifications by default', () => {
      const env = parseServerEnv(validEnv())

      expect(env.NOTIFICATIONS_ENABLED).toBe(false)
    })

    it('should not require provider credentials when notifications are disabled', () => {
      const raw = validEnv({ NOTIFICATIONS_ENABLED: 'false' })

      expect(() => parseServerEnv(raw)).not.toThrow()
    })

    it('should throw when notifications are enabled without provider credentials', () => {
      const raw = validEnv({ NOTIFICATIONS_ENABLED: 'true' })

      expect(() => parseServerEnv(raw)).toThrow(/NOTIFICATIONS_ENABLED=true exige/)
    })

    it('should name every missing credential when notifications are enabled', () => {
      const raw = validEnv({
        NOTIFICATIONS_ENABLED: 'true',
        RESEND_API_KEY: 're_test',
        EMAIL_FROM: 'contact@schedulr.fr',
      })

      expect(() => parseServerEnv(raw)).toThrow(
        /TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_PHONE_NUMBER/,
      )
    })

    it('should require the cron secret when notifications are enabled', () => {
      // Sans lui, la route de rappels serait ouverte : n'importe qui pourrait
      // déclencher une vague d'envois, chacun facturé.
      const raw = validEnv({
        NOTIFICATIONS_ENABLED: 'true',
        RESEND_API_KEY: 're_test',
        EMAIL_FROM: 'contact@schedulr.fr',
        TWILIO_ACCOUNT_SID: 'AC_test',
        TWILIO_AUTH_TOKEN: 'token_test',
        TWILIO_PHONE_NUMBER: '+33600000000',
      })

      expect(() => parseServerEnv(raw)).toThrow(/CRON_SECRET/)
    })

    it('should accept enabled notifications when every credential is present', () => {
      const raw = validEnv({
        NOTIFICATIONS_ENABLED: 'true',
        RESEND_API_KEY: 're_test',
        EMAIL_FROM: 'contact@schedulr.fr',
        TWILIO_ACCOUNT_SID: 'AC_test',
        TWILIO_AUTH_TOKEN: 'token_test',
        TWILIO_PHONE_NUMBER: '+33600000000',
        CRON_SECRET: 'secret-de-cron-suffisamment-long',
      })

      const env = parseServerEnv(raw)

      expect(env.NOTIFICATIONS_ENABLED).toBe(true)
    })
  })
})
