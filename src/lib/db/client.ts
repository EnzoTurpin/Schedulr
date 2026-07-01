import { PrismaClient } from '@/generated/prisma'
import { env } from '../env.server'

/**
 * Client Prisma partagé.
 *
 * En développement, Next.js recharge les modules à chaud : sans mise en cache
 * sur l'objet global, chaque rechargement ouvrirait un nouveau pool de
 * connexions jusqu'à saturer PostgreSQL.
 *
 * ⚠️ Ce client n'est **pas** cloisonné par salon. L'ADR-0002 impose de passer
 * par le client scopé (`forSalon()`, livré en phase 1) pour toute lecture ou
 * écriture de donnée métier. L'usage direct est réservé à la couche d'accès
 * aux données, aux requêtes explicitement inter-salons et aux migrations.
 */

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: env.NODE_ENV === 'development' ? ['query', 'warn', 'error'] : ['warn', 'error'],
  })

if (env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma
}
