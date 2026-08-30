import { tools, type InputSchema, type RegistryOptions, type ToolDef } from '../tools'

const reportRegistrationError = (error: unknown) => {
  console.error('[webmcpable] Tool registration failed.', error)
}

/**
 * Register WebMCP tools, tied to the current effect scope.
 *
 * `$effect` tracks whatever reactive state a `when` predicate reads, so the
 * agent's tool list follows the UI with no manual `revalidate()`. Call it in a
 * component, or inside `$effect.root` for app-level tools.
 */
export function useTools<T extends Record<string, InputSchema | undefined>>(
  defs: { [K in keyof T]: ToolDef<T[K]> },
  options?: RegistryOptions,
): void {
  const registry = tools(defs, options)

  $effect(() => {
    // Reading state inside `when` registers a dependency here, so this re-runs
    // whenever that state changes.
    void registry.revalidate().catch(reportRegistrationError)
  })

  // This effect has no reactive dependencies, so cleanup runs when the
  // component's effect scope closes rather than on every state change.
  $effect(() => () => registry.unmount())
}
