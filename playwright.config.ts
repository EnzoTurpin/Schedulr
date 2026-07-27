import { defineConfig, devices } from '@playwright/test'

/**
 * Tests de bout en bout.
 *
 * Ils s'exécutent contre l'application réelle, sur la base `schedulr_e2e` :
 * jamais sur la base de développement, que les tests videraient.
 */

const PORT = 3100
const BASE_URL = `http://127.0.0.1:${PORT}`

const DATABASE_URL =
  process.env.E2E_DATABASE_URL ??
  `postgresql://${process.env.USER ?? 'postgres'}@localhost:5432/schedulr_e2e`

export default defineConfig({
  testDir: './tests/e2e',
  // Les tests partagent une base : les paralléliser les ferait s'effacer
  // mutuellement leurs données, comme en intégration.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list']],

  use: {
    baseURL: BASE_URL,
    // Trace conservée au premier échec : indispensable pour diagnostiquer un
    // test rouge en CI sans pouvoir le reproduire localement.
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    locale: 'fr-FR',
    timezoneId: 'Europe/Paris',
  },

  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],

  webServer: {
    // Build de production : c'est ce qui sera déployé, et le mode
    // développement masque des erreurs de rendu serveur.
    command: `pnpm build && pnpm start --port ${PORT}`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    env: {
      DATABASE_URL,
      AUTH_SECRET: 'secret-e2e-uniquement-32-caracteres-minimum',
      APP_URL: BASE_URL,
      NEXT_PUBLIC_APP_URL: BASE_URL,
      NOTIFICATIONS_ENABLED: 'false',
      NODE_ENV: 'production',
    },
  },
})
