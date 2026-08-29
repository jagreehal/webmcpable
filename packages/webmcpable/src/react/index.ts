import { useEffect, useRef } from 'react'
import { descriptorKey, tools, type InputSchema, type Registry, type ToolDef } from '../tools'

const reportRegistrationError = (error: unknown) => {
  console.error('[webmcpable] Tool registration failed.', error)
}

// Shared with `tools()`, so the browser descriptor and React's re-registration
// trigger can never disagree about what counts as a change.
const registrationKey = (defs: Record<string, ToolDef>): string =>
  JSON.stringify(Object.entries(defs).map(([name, def]) => descriptorKey(name, def)))

/**
 * Register WebMCP tools for as long as this component is mounted.
 *
 * The adapter's entire job is to drive `revalidate()` from React's own
 * reactivity — it runs after every render, so a `when` predicate reading
 * component state stays accurate with no manual call. Deliberately thin: no
 * dependency tracking, no signals, no state model of its own.
 */
export function useTools<T extends Record<string, InputSchema | undefined>>(
  defs: { [K in keyof T]: ToolDef<T[K]> },
): void {
  const registry = useRef<Registry>(undefined)
  const latest = useRef(defs)
  // oxlint-disable-next-line refs
  latest.current = defs
  const identity = registrationKey(defs as Record<string, ToolDef>)

  useEffect(() => {
    // Read definitions through a ref so re-renders never re-register; only
    // `when` results decide what is registered.
    const live = tools(
      Object.fromEntries(
        Object.keys(latest.current).map((name) => [
          name,
          {
            ...(latest.current[name] as ToolDef),
            // Always resolve against the newest closure, so handlers and
            // predicates see current props and state rather than mount-time
            // values.
            handler: (input: never, options: { signal: AbortSignal }) =>
              (latest.current[name] as ToolDef).handler(input, options),
            when: () => (latest.current[name] as ToolDef).when?.() ?? true,
          },
        ]),
      ) as Record<string, ToolDef>,
    )

    registry.current = live
    void live.mount().catch(reportRegistrationError)

    return () => {
      // StrictMode mounts, unmounts and remounts. Aborting on cleanup means
      // the remount registers cleanly instead of colliding with an orphan.
      live.unmount()
      registry.current = undefined
    }
    // Handlers and predicates use refs. Registration metadata and schemas must
    // replace the browser descriptor when they change.
  }, [identity])

  // Runs after every render, so `when` reflects the state that just rendered.
  // oxlint-disable-next-line @nkzw/require-use-effect-arguments
  useEffect(() => {
    void registry.current?.revalidate().catch(reportRegistrationError)
  })
}
