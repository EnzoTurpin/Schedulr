import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tsconfigPaths from 'vite-tsconfig-paths'

export default defineConfig({
  plugins: [tsconfigPaths(), react()],
  test: {
    environment: 'node',
    globals: false,
    include: ['tests/unit/**/*.test.ts?(x)', 'tests/integration/**/*.test.ts?(x)'],

    /**
     * Les fichiers de test s'exécutent en série.
     *
     * Les tests d'intégration partagent une seule base PostgreSQL et la vident
     * par `TRUNCATE` entre chaque cas : exécutés en parallèle, deux fichiers
     * s'effacent mutuellement leurs données et échouent de façon erratique.
     *
     * Le coût est négligeable à cette échelle. Si la suite d'intégration
     * s'allonge, la bonne réponse sera un schéma PostgreSQL par worker, pas de
     * réactiver le parallélisme sur une base partagée.
     */
    fileParallelism: false,

    /**
     * Marge pour les tests d'intégration : ils ouvrent de vraies connexions
     * PostgreSQL et exercent des écritures concurrentes. Le défaut de 5 s est
     * trop juste au démarrage à froid du moteur Prisma.
     */
    testTimeout: 20_000,

    // Les tests ne doivent jamais dépendre de l'heure ni du fuseau de la
    // machine : le moteur de disponibilité manipule des dates locales et des
    // changements d'heure (voir ADR-0003).
    env: {
      TZ: 'UTC',

      /**
       * Base des tests d'intégration.
       *
       * ⚠️ Le bloc `env` de Vitest **écrase** l'environnement du processus : un
       * `DATABASE_URL` déjà fourni — par la CI notamment — doit donc être
       * respecté explicitement, sinon il est remplacé par la valeur construite
       * ici. C'est ce qui faisait échouer les 87 tests d'intégration en CI,
       * l'URL déduite de `USER` donnant l'utilisateur `runner`, inexistant côté
       * PostgreSQL.
       */
      DATABASE_URL:
        process.env.TEST_DATABASE_URL ??
        process.env.DATABASE_URL ??
        `postgresql://${process.env.USER ?? 'postgres'}@localhost:5432/schedulr_test`,
    },

    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      include: ['src/**/*.{ts,tsx}'],
      exclude: [
        'src/**/*.d.ts',
        // Interface et frontières HTTP : couvertes par Playwright en phase 3,
        // pas par des tests unitaires. Les y inclure ferait passer la métrique
        // pour une mesure de la logique métier alors qu'elle mesurerait surtout
        // du JSX non exécuté.
        'src/app/**',
        'src/middleware.ts',
        // Server actions : frontière HTTP, comme les pages. Elles
        // authentifient, valident et délèguent — la logique qu'elles appellent
        // est testée en intégration, et leur câblage l'est par Playwright.
        'src/features/**/actions.ts',
        'src/**/*.tsx',
        // Déclarations de types pures, sans code exécutable.
        'src/features/availability/types.ts',
        'src/generated/**',
      ],
      thresholds: {
        // Seuils du CLAUDE.md.
        lines: 80,
        functions: 80,
        branches: 75,
        statements: 80,

        /**
         * Le moteur de disponibilité porte le risque principal du produit
         * (ADR-0003) : un défaut y propose un créneau indisponible ou masque un
         * créneau libre. Son seuil est relevé et vérifié séparément.
         *
         * Les quelques branches non couvertes sont des gardes imposées par
         * `noUncheckedIndexedAccess`, inatteignables à l'exécution — d'où un
         * seuil de branches inférieur à celui des lignes.
         */
        'src/features/availability/**': {
          lines: 95,
          functions: 100,
          branches: 90,
          statements: 95,
        },
      },
    },
  },
})
