import { parseServerEnv, type ServerEnv } from './env.schema'

/**
 * Environnement serveur validé, résolu à l'import.
 *
 * Importer ce module suffit à déclencher la validation : le processus s'arrête
 * au démarrage si la configuration est incomplète, plutôt qu'à la première
 * requête utilisateur (principe « fail fast » du CLAUDE.md).
 */

// Empêche l'import depuis un composant client, qui exposerait les secrets
// dans le lot JavaScript envoyé au navigateur.
if (typeof window !== 'undefined') {
  throw new Error(
    'env.server.ts a été importé côté client. Utilisez env.client.ts pour les ' +
      'valeurs publiques.',
  )
}

export const env: ServerEnv = parseServerEnv(process.env)

export { EnvValidationError, type ServerEnv } from './env.schema'
