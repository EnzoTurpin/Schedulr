import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { FlatCompat } from '@eslint/eslintrc'
import tseslint from 'typescript-eslint'
import prettierConfig from 'eslint-config-prettier'

const compat = new FlatCompat({
  baseDirectory: dirname(fileURLToPath(import.meta.url)),
})

export default tseslint.config(
  {
    ignores: [
      'node_modules/**',
      '.next/**',
      'coverage/**',
      'next-env.d.ts',
      'src/generated/**',
    ],
  },

  ...compat.extends('next/core-web-vitals'),
  ...tseslint.configs.recommended,

  {
    rules: {
      // Les variables préfixées d'un souligné sont volontairement inutilisées.
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],

      // CLAUDE.md : interdiction d'avaler une erreur silencieusement.
      'no-empty': ['error', { allowEmptyCatch: false }],

      // CLAUDE.md : pas de console.log de debug oublié. warn/error restent
      // autorisés, ils servent au logging applicatif volontaire.
      'no-console': ['error', { allow: ['warn', 'error'] }],

      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'prefer-const': 'error',
      'no-var': 'error',
    },
  },

  // Les tests et scripts ont des besoins plus permissifs.
  {
    files: ['tests/**/*.ts', 'tests/**/*.tsx', 'prisma/seed.ts', 'scripts/**/*.ts'],
    rules: {
      'no-console': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },

  // Doit rester en dernier : neutralise les règles de style qui entrent en
  // conflit avec Prettier.
  prettierConfig,
)
