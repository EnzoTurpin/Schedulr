import { z } from 'zod'

/**
 * Variables d'environnement exposables au navigateur.
 *
 * Toute valeur ajoutée ici part dans le lot JavaScript public : n'y placer
 * que ce qui est déjà visible de l'utilisateur. Les secrets vivent dans
 * env.server.ts.
 *
 * Next.js remplace les `process.env.NEXT_PUBLIC_*` à la compilation ; ils
 * doivent donc être écrits littéralement, sans accès dynamique.
 */

const clientEnvSchema = z.object({
  NEXT_PUBLIC_APP_URL: z.string().min(1),
})

export type ClientEnv = z.infer<typeof clientEnvSchema>

export const clientEnv: ClientEnv = clientEnvSchema.parse({
  NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
})
