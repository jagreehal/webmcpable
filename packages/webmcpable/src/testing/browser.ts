import { installTestModelContext, type TestModelContext } from './index'

/**
 * The `webmcpable/testing` fake, as a script a browser can load.
 *
 * `page.addInitScript` serialises what it is handed, so the in-process
 * `installTestModelContext()` cannot cross into a page — it closes over module
 * scope. This entry is bundled to a standalone script instead, and parks the
 * handle on `window` so `webmcpable/testing/playwright` can read the recorded
 * calls back out.
 *
 * It runs before any of the page's own scripts, which is what lets an
 * application's `document.modelContext` lookup find the fake at mount time.
 */

declare global {
  interface Window {
    __webmcpableTesting?: TestModelContext
  }
}

window.__webmcpableTesting = installTestModelContext()
