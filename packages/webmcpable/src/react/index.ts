import { useEffect, useRef } from 'react'
import { tools, type InputSchema, type Registry, type RegistryOptions, type ToolDef } from '../tools'

const reportRegistrationError = (error: unknown) => {
  console.error('[webmcpable] Tool registration failed.', error)
}

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
  options: RegistryOptions = {},
): void {
  const registry = useRef<Registry>(undefined)
  const latest = useRef(defs)
  const latestOptions = useRef(options)
  // oxlint-disable-next-line refs
  latest.current = defs
  // oxlint-disable-next-line refs
  latestOptions.current = options

  useEffect(() => {
    // The registry reads the definitions through this view rather than a copy,
    // so a tool arriving, leaving, or changing its description never rebuilds
    // it. That matters beyond tidiness: rebuilding would discard the record of
    // the descriptor the user first consented to.
    const view = new Proxy({} as Record<string, ToolDef>, {
      get(_target, name) {
        if (typeof name !== 'string') {return undefined}
        const def = () => latest.current[name] as ToolDef
        return {
          get annotations() { return def().annotations },
          get description() { return def().description },
          get exposedTo() { return def().exposedTo },
          get input() { return def().input },
          get title() { return def().title },
          // Always resolve against the newest closure, so handlers and
          // predicates see current props and state rather than mount-time
          // values.
          execute: (input: never, options: { signal: AbortSignal }) =>
            def().execute(input, options),
          when: () => def().when?.() ?? true,
          // The input type is erased here exactly as it is in `tools()`: the
          // schema has already validated the value by the time it arrives.
        } as ToolDef
      },
      getOwnPropertyDescriptor: () => ({ configurable: true, enumerable: true }),
      has: (_target, name) => typeof name === 'string' && name in latest.current,
      ownKeys: () => Object.keys(latest.current),
    })

    const live = tools(view, {
      get confirm() {
        return latestOptions.current.confirm
      },
      get titles() {
        return latestOptions.current.titles
      },
    })

    registry.current = live
    void live.mount().catch(reportRegistrationError)

    return () => {
      // StrictMode mounts, unmounts and remounts. Aborting on cleanup means
      // the remount registers cleanly instead of colliding with an orphan.
      live.unmount()
      registry.current = undefined
    }
  }, [])

  // Runs after every render, so `when` reflects the state that just rendered.
  // oxlint-disable-next-line @nkzw/require-use-effect-arguments
  useEffect(() => {
    void registry.current?.revalidate().catch(reportRegistrationError)
  })
}
