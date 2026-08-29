import { createRequire } from 'node:module'
import { defineConfig } from '@playwright/test'
import { CHROME_FLAGS, requireChrome } from './e2e/chrome'

const require = createRequire(import.meta.url)
const PORT = 5178

/**
 * The native lane. Everything else in this package tests against
 * `installTestModelContext()`, a hand-written transcription of Chrome's
 * behaviour. This lane drives the real thing, so the transcription can be
 * checked rather than trusted.
 *
 *   CHROME_BIN="/path/to/Chrome" pnpm test:conformance
 */
export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.conformance.ts',
  // A stale measurement that passes is worse than one that fails loudly.
  forbidOnly: !!process.env['CI'],
  fullyParallel: true,
  reporter: [
    ['list'],
    [
      require.resolve('executable-stories-playwright/reporter'),
      {
        formats: ['markdown'],
        output: { mode: 'aggregated' },
        outputDir: 'e2e',
        outputName: 'CHROME-CONFORMANCE',
      },
    ],
  ],
  use: {
    baseURL: `http://localhost:${PORT}`,
    launchOptions: { args: CHROME_FLAGS, executablePath: requireChrome() },
  },
  webServer: {
    command: `node e2e/fixtures/serve.mjs`,
    env: { PORT: String(PORT) },
    reuseExistingServer: true,
    url: `http://localhost:${PORT}/e2e/fixtures/harness.html`,
  },
})
