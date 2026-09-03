import { defineConfig } from '@playwright/test'

const PORT = 5179

/**
 * The fixture lane: `webmcpable/testing/playwright` driving an application in
 * Playwright's own bundled Chromium.
 *
 * Deliberately no `executablePath` and no flags. The conformance lane needs a
 * real Chrome because it measures the browser; this one needs the opposite — a
 * browser with no WebMCP at all — because what it proves is that a suite can
 * test its tools without one. If this ever starts passing for the wrong reason,
 * the lane's first test is the tripwire.
 */
export default defineConfig({
  forbidOnly: !!process.env['CI'],
  fullyParallel: true,
  reporter: [['list']],
  testDir: './e2e',
  testMatch: '**/*.fixture.ts',
  use: { baseURL: `http://localhost:${PORT}` },
  webServer: {
    command: `node e2e/fixtures/serve.mjs`,
    env: { PORT: String(PORT) },
    reuseExistingServer: true,
    url: `http://localhost:${PORT}/e2e/fixtures/app.html`,
  },
})
