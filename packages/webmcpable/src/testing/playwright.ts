import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { test as base, type Page } from '@playwright/test'
import type { RecordedCall } from './index'

/**
 * Drive a page's WebMCP tools from Playwright, in any browser.
 *
 * `webmcpable/testing` puts a fake `document.modelContext` in the *test*
 * process, which is all a component test needs. An end-to-end test has the
 * opposite problem: the application runs in a browser, and Playwright's bundled
 * Chromium carries no WebMCP at all. This installs the same fake in the page
 * instead, so a suite that never sees a flagged Chrome can still call the tools
 * an agent would call, and assert that the UI moved with them.
 *
 * The fake is the one measured against Chrome 152 in `e2e/*.conformance.ts`,
 * so its quirks are the browser's quirks: a JSON-string `inputSchema`, a
 * name-sorted tool list, a canned message when a handler throws.
 */

const HERE = import.meta.dirname

/**
 * The bundled `browser.ts`.
 *
 * Beside this module once shipped — both land in `dist` — and two levels up
 * when this package runs its own suite straight from `src`.
 *
 * Resolved on use rather than at import, and from `import.meta.dirname` rather
 * than `new URL(..., import.meta.url)`: Vite rewrites that exact shape into an
 * asset reference, so under Vitest the path comes back as an http URL pointing
 * at a dev server that is not running.
 */
const browserScript = (): string => {
  const candidates = [
    join(HERE, 'testing-browser.iife.js'),
    join(HERE, '..', '..', 'dist', 'testing-browser.iife.js'),
  ]
  const found = candidates.find((candidate) => existsSync(candidate))
  if (!found) {
    throw new Error(
      'webmcpable/testing/playwright could not find its browser bundle. Looked in:\n  ' +
        candidates.join('\n  ') +
        '\nBuild the package before running the suite.',
    )
  }
  return found
}

export type { RecordedCall } from './index'

export interface PageTool {
  /** Chrome keeps only these two, and returns both once any are sent. */
  annotations?: { readOnlyHint: boolean; untrustedContentHint: boolean }
  description: string
  /**
   * Parsed, unlike `getTools()` in the page.
   *
   * Chrome hands `inputSchema` back as a JSON string, and reaching for
   * `.properties` on it silently yields undefined — the single most common way
   * a WebMCP test passes for the wrong reason. Nothing is lost by parsing here:
   * the raw string cannot cross into the test process as anything but text.
   */
  inputSchema: Record<string, unknown> | undefined
  name: string
  origin: string
  title: string
}

export interface PageModelContext {
  /**
   * Every tool invocation so far, in order, with its parsed input.
   *
   * A snapshot, read out of the page on each call. The fake belongs to one
   * document, so a navigation starts the list again.
   */
  calls(): Promise<Array<RecordedCall>>
  /**
   * Execute a tool the way an agent does: by name, with an input object.
   *
   * Chrome requires the input as a JSON *string* and rejects an object, so this
   * serialises for you. The lookup goes through `getTools()` rather than
   * straight to the registry, because that is the path an agent takes.
   */
  callTool(name: string, input?: unknown): Promise<string>
  /** The tools the page has registered, name-sorted the way the browser sorts them. */
  getTools(): Promise<Array<PageTool>>
}

const pageModelContext = (page: Page): PageModelContext => ({
  calls: () => page.evaluate(() => window.__webmcpableTesting?.calls ?? []),

  callTool: (name, input = {}) =>
    page.evaluate(
      async ([toolName, inputArguments]: [string, string]) => {
        const context = document.modelContext
        if (!context) {
          throw new Error('document.modelContext is undefined: the fake was never installed.')
        }
        const tool = (await context.getTools()).find((candidate) => candidate.name === toolName)
        if (!tool) {
          throw new Error(`No tool named "${toolName}" is registered on this page.`)
        }
        // The doctor's chained-execute rule is about a handler starting a second
        // tool. This is the agent's side of the first one.
        return context.executeTool(tool, inputArguments) // webmcpable-ignore
      },
      [name, JSON.stringify(input)] as [string, string],
    ),

  getTools: () =>
    page.evaluate(async () => {
      const context = document.modelContext
      if (!context) {
        throw new Error('document.modelContext is undefined: the fake was never installed.')
      }
      return (await context.getTools()).map((tool) => {
        let inputSchema: Record<string, unknown> | undefined
        try {
          inputSchema =
            typeof tool.inputSchema === 'string'
              ? (JSON.parse(tool.inputSchema) as Record<string, unknown>)
              : (tool.inputSchema as Record<string, unknown> | undefined)
        } catch {
          inputSchema = undefined
        }
        return {
          // Both hints are always present once any are sent, so narrow the
          // draft's all-optional shape to what a caller can actually rely on.
          ...(tool.annotations
            ? {
                annotations: {
                  readOnlyHint: tool.annotations.readOnlyHint === true,
                  untrustedContentHint: tool.annotations.untrustedContentHint === true,
                },
              }
            : {}),
          description: tool.description,
          inputSchema,
          name: tool.name,
          origin: tool.origin,
          title: tool.title,
        }
      })
    }),
})

/**
 * Install the fake into `page`, and hand back the ways to drive it.
 *
 * Call this before the first `goto`. For a suite that already has its own
 * fixtures, this is the piece to reach for; for a new one, the `test` export
 * below has already done it.
 */
export async function installTestModelContext(page: Page): Promise<PageModelContext> {
  await page.addInitScript({ path: browserScript() })
  return pageModelContext(page)
}

/**
 * A `test` with the fake already installed.
 *
 * The install hangs off `page` rather than off `modelContext`, so it happens
 * whether or not a test asks for the tools — a fixture that only ran when it
 * was named would miss the page that registers its tools on load.
 */
export const test = base.extend<{ modelContext: PageModelContext }>({
  modelContext: async ({ page }, use) => {
    // oxlint-disable-next-line react-hooks/rules-of-hooks -- Playwright's fixture `use`, not React's
    await use(pageModelContext(page))
  },

  page: async ({ page }, use) => {
    await page.addInitScript({ path: browserScript() })
    // oxlint-disable-next-line react-hooks/rules-of-hooks -- Playwright's fixture `use`, not React's
    await use(page)
  },
})

export { expect } from '@playwright/test'
