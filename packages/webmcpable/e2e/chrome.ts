import { existsSync } from 'node:fs'

/**
 * WebMCP ships behind flags, so the native lane needs a real Chrome binary —
 * Playwright's bundled Chromium does not carry the implementation.
 *
 * Chrome 152 is the floor. 149-151 exposed only the testing surface under
 * headless, and 152 is also where `navigator.modelContext` and
 * `navigator.modelContextTesting` were withdrawn.
 */
export const MINIMUM_CHROME = 152

export const CHROME_FLAGS = [
  '--enable-experimental-web-platform-features',
  '--enable-features=WebMCPTesting,DevToolsWebMCPSupport',
]

const CANDIDATES = [
  process.env['CHROME_BIN'],
  process.env['PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH'],
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/opt/google/chrome/chrome',
]

/** The Chrome this lane will drive, or undefined when there is none to drive. */
export const chromePath = (): string | undefined =>
  CANDIDATES.find((path): path is string => typeof path === 'string' && existsSync(path))

/**
 * Playwright falls back to its bundled Chromium when `executablePath` is
 * undefined, and that build carries no WebMCP — the failure would look like a
 * missing API rather than a missing browser. Say which it is.
 */
export const requireChrome = (): string => {
  const path = chromePath()
  if (!path) {
    throw new Error(
      'No Chrome found for the WebMCP conformance lane. Install Google Chrome 152+ ' +
        'or set CHROME_BIN to its executable.',
    )
  }
  return path
}
