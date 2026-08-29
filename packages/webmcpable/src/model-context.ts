/** The page's `document.modelContext`, narrowed, with a useful failure. */
export function modelContext(): WebMCP.ModelContext {
  if (typeof document === 'undefined') {
    throw new Error('WebMCP is unavailable outside a browser document.')
  }
  const value = document.modelContext
  if (!value) {
    throw new Error(
      'WebMCP is unavailable: document.modelContext is undefined. ' +
        'Use a browser with WebMCP enabled, or installTestModelContext() from webmcpable/testing.',
    )
  }
  return value
}

/** True when the page can register tools at all. */
export const isSupported = (): boolean =>
  typeof document !== 'undefined' && Boolean(document.modelContext)
