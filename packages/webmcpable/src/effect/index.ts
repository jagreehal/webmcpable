import { Cause, Data, Effect, Stream, SubscriptionRef } from 'effect'
import { readInputSchema } from '../schema'
import { tools, type InputSchema, type RegistryOptions, type ToolDef } from '../tools'

/**
 * Effect-native WebMCP tools.
 *
 * Handlers are Effects, failures are typed, and `when` predicates are Effects
 * too — so a `SubscriptionRef` in `watch` re-evaluates them automatically and
 * the agent's tool list tracks application state with no manual `revalidate()`.
 */

/** A failure the agent should be told about, in words it can act on. */
export class ToolFailure extends Data.TaggedError('ToolFailure')<{
  readonly message: string
}> {}

type Infer<S> = S extends { '~standard': unknown }
  ? S extends { '~standard': { types?: { output: infer O } } }
    ? O
    : Record<string, unknown>
  : Record<string, unknown>

export interface EffectToolDef<S extends InputSchema | undefined = InputSchema | undefined> {
  annotations?: { readOnlyHint?: boolean; untrustedContentHint?: boolean }
  description: string
  execute: (
    input: Infer<S>,
    options: { signal: AbortSignal },
  ) => Effect.Effect<unknown, unknown>
  input?: S
  title?: string
  /** Re-evaluated on every watched change. A string refuses with that reason. */
  when?: () => Effect.Effect<boolean | string>
}

export interface EffectRegistry {
  readonly mount: Effect.Effect<void>
  readonly revalidate: Effect.Effect<void>
}

export interface EffectToolsOptions {
  confirm?: RegistryOptions['confirm'] | undefined
  titles?: RegistryOptions['titles'] | undefined
  /** Changes to any of these re-evaluate every `when` predicate. */
  // `any` rather than `unknown`: SubscriptionRef is invariant, so `unknown`
  // would reject every concrete ref a caller actually has.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  watch?: ReadonlyArray<SubscriptionRef.SubscriptionRef<any>>
}

// oxlint-disable @nkzw/no-instanceof -- narrowing an unknown cause is the point
const describeFailure = (cause: unknown): string => {
  if (cause instanceof ToolFailure) {return cause.message}
  if (cause instanceof Error) {return `${cause.name}: ${cause.message}`}
  if (typeof cause === 'object' && cause !== null && '_tag' in cause) {
    const tagged = cause as { _tag: string; message?: unknown }
    return typeof tagged.message === 'string' ? tagged.message : `Failed: ${tagged._tag}`
  }
  return String(cause)
}

export const effectTools = Effect.fn('effectTools')(function* <
  T extends Record<string, EffectToolDef>,
>(defs: T, options: EffectToolsOptions = {}) {
  const plain = Object.fromEntries(
    Object.entries(defs).map(([name, def]) => [
      name,
      {
        description: def.description,
        ...(def.title !== undefined && { title: def.title }),
        ...(def.input !== undefined && { input: def.input }),
        ...(def.annotations && { annotations: def.annotations }),
        // `when` must answer synchronously: the platform decides registration
        // at call time, so there is nowhere to await.
        ...(def.when && { when: () => Effect.runSync(def.when!()) }),
        execute: (input: never, opts: { signal: AbortSignal }) =>
          Effect.runPromise(
            def.execute(input, opts).pipe(
              // Chrome erases thrown errors, so a failure has to come back as
              // text or the agent learns nothing at all.
              Effect.catchCause((cause) =>
                Effect.succeed(describeFailure(Cause.squash(cause))),
              ),
            ),
          ),
      },
    ]),
  ) as Record<string, ToolDef>

  const registry = tools(plain, { confirm: options.confirm, titles: options.titles })

  // Tools come down when the scope closes.
  yield* Effect.addFinalizer(() => Effect.sync(() => registry.unmount()))

  const revalidate = Effect.promise(() => registry.revalidate())

  // Every watched ref drives revalidation for as long as the scope is open.
  for (const ref of options.watch ?? []) {
    yield* Effect.forkScoped(
      Stream.runForEach(SubscriptionRef.changes(ref), () => revalidate),
    )
  }

  return {
    mount: Effect.promise(() => registry.mount()),
    revalidate,
  } satisfies EffectRegistry
})

export { readInputSchema }
