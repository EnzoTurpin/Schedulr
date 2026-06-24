import { prisma } from './client'
import { isTenantModel } from './tenant-models'

/**
 * Client Prisma cloisonné sur un salon (ADR-0002).
 *
 * Toute requête portant sur un modèle métier se voit injecter `salonId` — dans
 * `where` pour les lectures et les écritures ciblées, dans `data` pour les
 * créations. Un développeur qui oublie le filtre obtient malgré tout une
 * requête cloisonnée.
 *
 * Règle d'usage : le client brut (`prisma`) est **interdit** hors de la couche
 * d'accès aux données. Les requêtes réellement inter-salons — recherche
 * publique, statistiques plateforme — passent par `crossSalon()`, dont le nom
 * rend l'intention visible en revue.
 *
 * Limite connue : les écritures imbriquées (`salon.update({ data: { services:
 * { create: … } } })`) ne traversent pas cette extension. Elles restent
 * néanmoins sûres par construction, `salonId` étant obligatoire sur les
 * modèles métier : Prisma refuse la requête si la colonne n'est pas fournie.
 */

/** Opérations dont le cloisonnement passe par `where`. */
const WHERE_OPERATIONS = new Set([
  'findUnique',
  'findUniqueOrThrow',
  'findFirst',
  'findFirstOrThrow',
  'findMany',
  'count',
  'aggregate',
  'groupBy',
  'update',
  'updateMany',
  'updateManyAndReturn',
  'delete',
  'deleteMany',
])

/** Opérations dont le cloisonnement passe par `data`. */
const DATA_OPERATIONS = new Set(['create', 'createMany', 'createManyAndReturn'])

type QueryArgs = {
  where?: Record<string, unknown>
  data?: Record<string, unknown> | Record<string, unknown>[]
  create?: Record<string, unknown>
}

function withSalonInWhere(args: QueryArgs, salonId: string): QueryArgs {
  return { ...args, where: { ...(args.where ?? {}), salonId } }
}

function withSalonInData(args: QueryArgs, salonId: string): QueryArgs {
  const { data } = args
  if (Array.isArray(data)) {
    return { ...args, data: data.map((row) => ({ ...row, salonId })) }
  }
  return { ...args, data: { ...(data ?? {}), salonId } }
}

export function forSalon(salonId: string) {
  if (!salonId) {
    throw new Error(
      'forSalon() appelé sans salonId : cela produirait un client non cloisonné.',
    )
  }

  return prisma.$extends({
    name: 'salonScope',
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          if (!isTenantModel(model)) {
            return query(args)
          }

          const typedArgs = args as QueryArgs

          // Les casts sont inévitables : `query` est typé sur l'union de tous
          // les arguments possibles de tous les modèles, que l'on ne peut pas
          // reconstruire depuis une extension générique. La forme des objets
          // produits est vérifiée par les tests d'intégration d'isolation.
          const forward = (next: QueryArgs) => query(next as typeof args)

          if (operation === 'upsert') {
            return forward({
              ...withSalonInWhere(typedArgs, salonId),
              create: { ...(typedArgs.create ?? {}), salonId },
            })
          }

          if (WHERE_OPERATIONS.has(operation)) {
            return forward(withSalonInWhere(typedArgs, salonId))
          }

          if (DATA_OPERATIONS.has(operation)) {
            return forward(withSalonInData(typedArgs, salonId))
          }

          // Fermeture par défaut : une opération inconnue ne doit jamais passer
          // sans filtre. Mieux vaut casser bruyamment que fuiter en silence —
          // c'est le sens même d'une frontière de sécurité.
          throw new Error(
            `Opération « ${operation} » non gérée par le cloisonnement par salon ` +
              `(modèle ${model}). Ajouter son traitement dans src/lib/db/scoped.ts ` +
              `avant de l'utiliser.`,
          )
        },
      },
    },
  })
}

export type ScopedPrismaClient = ReturnType<typeof forSalon>

/**
 * Accès délibérément non cloisonné.
 *
 * Réservé à trois usages : la recherche publique de salons, les statistiques de
 * l'espace administrateur plateforme, et les migrations. Tout autre appel est
 * un défaut d'isolation.
 *
 * @param reason Motif consigné à la revue — force à justifier l'appel.
 */
export function crossSalon(reason: string) {
  if (!reason) {
    throw new Error('crossSalon() exige un motif explicite.')
  }
  return prisma
}
