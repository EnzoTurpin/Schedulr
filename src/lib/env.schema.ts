import { z } from 'zod'

/**
 * Schéma et validation des variables d'environnement serveur.
 *
 * Ce module est volontairement **sans effet de bord** : il n'accède pas à
 * `process.env`. Le singleton validé au démarrage vit dans env.server.ts.
 * Cette séparation permet de tester la validation sans manipuler
 * l'environnement du processus de test.
 */

const postgresUrl = z
  .string()
  .min(1)
  .refine(
    (value) => value.startsWith('postgres://') || value.startsWith('postgresql://'),
    { message: 'doit être une URL PostgreSQL (postgres:// ou postgresql://)' },
  )

export const serverEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

  DATABASE_URL: postgresUrl,

  /**
   * Base jetable utilisée par `prisma migrate` et par la détection de dérive
   * de schéma en intégration continue (voir ADR-0004).
   */
  SHADOW_DATABASE_URL: postgresUrl.optional(),

  /**
   * Secret de signature des sessions Auth.js. 32 caractères minimum, généré
   * par `openssl rand -base64 32`.
   */
  AUTH_SECRET: z.string().min(32, 'doit contenir au moins 32 caractères'),

  /** URL publique de l'application, sans slash final. */
  APP_URL: z
    .string()
    .min(1)
    .refine((value) => !value.endsWith('/'), {
      message: 'ne doit pas se terminer par un slash',
    }),

  // --- Fournisseurs de notification -------------------------------------
  // Optionnels tant que la phase 6 n'est pas livrée, mais exigés dès que le
  // coupe-circuit ci-dessous est armé.
  RESEND_API_KEY: z.string().min(1).optional(),
  EMAIL_FROM: z.string().min(3).includes('@').optional(),

  TWILIO_ACCOUNT_SID: z.string().min(1).optional(),
  TWILIO_AUTH_TOKEN: z.string().min(1).optional(),
  TWILIO_PHONE_NUMBER: z.string().min(1).optional(),

  /**
   * Coupe-circuit d'envoi. Laissé à `false`, aucun courriel ni SMS ne part :
   * indispensable en préproduction pour ne pas écrire à de vrais clients.
   */
  NOTIFICATIONS_ENABLED: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
})

export type ServerEnv = z.infer<typeof serverEnvSchema>

/**
 * Variables brutes, telles que fournies par le processus.
 *
 * Volontairement plus large que `NodeJS.ProcessEnv` : Next.js augmente ce type
 * en rendant certaines clés obligatoires, ce qui empêcherait de construire des
 * jeux de variables partiels dans les tests.
 */
export type RawEnv = Record<string, string | undefined>

export class EnvValidationError extends Error {
  constructor(public readonly issues: string[]) {
    super(
      `Variables d'environnement invalides :\n${issues.map((i) => `  - ${i}`).join('\n')}\n\n` +
        `Voir .env.example pour la liste attendue.`,
    )
    this.name = 'EnvValidationError'
  }
}

/**
 * Valide un jeu de variables brut.
 *
 * @throws {EnvValidationError} si une variable est manquante ou invalide.
 */
export function parseServerEnv(raw: RawEnv): ServerEnv {
  const result = serverEnvSchema.safeParse(raw)

  if (!result.success) {
    throw new EnvValidationError(
      result.error.issues.map((issue) => {
        const path = issue.path.join('.') || '(racine)'
        return `${path} : ${issue.message}`
      }),
    )
  }

  const env = result.data

  // Armer le coupe-circuit sans identifiants complets ferait échouer chaque
  // envoi silencieusement, rendez-vous après rendez-vous.
  if (env.NOTIFICATIONS_ENABLED) {
    const missing = (
      [
        ['RESEND_API_KEY', env.RESEND_API_KEY],
        ['EMAIL_FROM', env.EMAIL_FROM],
        ['TWILIO_ACCOUNT_SID', env.TWILIO_ACCOUNT_SID],
        ['TWILIO_AUTH_TOKEN', env.TWILIO_AUTH_TOKEN],
        ['TWILIO_PHONE_NUMBER', env.TWILIO_PHONE_NUMBER],
      ] as const
    )
      .filter(([, value]) => !value)
      .map(([name]) => name)

    if (missing.length > 0) {
      throw new EnvValidationError([
        `NOTIFICATIONS_ENABLED=true exige : ${missing.join(', ')}`,
      ])
    }
  }

  return env
}
