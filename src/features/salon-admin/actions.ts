/**
 * Actions de configuration du salon.
 *
 * Regroupées par domaine dans `actions/` : le fichier unique dépassait la
 * limite de taille du projet. Ce point d'entrée préserve les imports existants.
 */
export * from './actions/catalogue'
export * from './actions/horaires'
export * from './actions/equipe'
export * from './actions/parametres'
export * from './actions/invitations'
export type { ConfigResult } from './actions/shared'
