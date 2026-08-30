import { onScopeDispose, watchEffect } from 'vue'
import { tools, type InputSchema, type RegistryOptions, type ToolDef } from '../tools'

const reportRegistrationError = (error: unknown) => {
  console.error('[webmcpable] Tool registration failed.', error)
}

/**
 * Register WebMCP tools for the lifetime of the current component.
 *
 * `watchEffect` tracks whatever reactive state a `when` predicate reads, so the
 * agent's tool list follows the UI with no manual `revalidate()`.
 */
export function useTools<T extends Record<string, InputSchema | undefined>>(
  defs: { [K in keyof T]: ToolDef<T[K]> },
  options?: RegistryOptions,
): void {
  const registry = tools(defs, options)

  // Reading reactive state inside `when` registers a dependency here, so this
  // re-runs — and re-evaluates every predicate — whenever that state changes.
  watchEffect(() => {
    void registry.revalidate().catch(reportRegistrationError)
  })

  onScopeDispose(() => registry.unmount())
}
