import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

/**
 * Concatène des classes Tailwind en résolvant les conflits : la dernière
 * classe d'une même famille utilitaire gagne. Indispensable pour permettre à
 * un composant appelant de surcharger le style d'un composant de base.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}
