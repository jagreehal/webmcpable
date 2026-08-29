import type { StandardSchemaV1 } from '@standard-schema/spec'
import { modelContext } from './model-context'
import { toToolResult } from './result'

/** Anything we can turn into a JSON Schema: a Standard Schema, or JSON Schema itself. */
export type InputSchema = StandardSchemaV1 | Record<string, unknown>

type Infer<S> = S extends StandardSchemaV1 ? StandardSchemaV1.InferOutput<S> : Record<string, unknown>

export interface ToolDef<S extends InputSchema | undefined = InputSchema | undefined> {
  /** Only the two annotations the W3C draft actually defines. */
  annotations?: { readOnlyHint?: boolean; untrustedContentHint?: boolean }
  description: string
  /** Origins in the current document tree that may discover and call this tool. */
  exposedTo?: Array<string>
  handler: (input: Infer<S>, options: { signal: AbortSignal }) => unknown
  input?: S
  title?: string
  /**
   * Whether the agent may use this tool. Re-evaluated on `revalidate()`, so the
   * agent's tool list mirrors what the user can actually do right now.
   *
   * `false` unregisters it. A string keeps it registered and refuses every call
   * with that string, so the agent reads *why* it cannot export this report
   * instead of watching the tool vanish (webmachinelearning/webmcp#262).
   */
  when?: () => boolean | string
}

export interface Registry {
  mount(): Promise<void>
  revalidate(): Promise<void>
  unmount(): void
}

const isStandardSchema = (s: unknown): s is StandardSchemaV1 =>
  typeof s === 'object' && s !== null && '~standard' in s

export function toJsonSchema(input: InputSchema | undefined): Record<string, unknown> {
  if (!input) {return { properties: {}, type: 'object' }}
  // zod v4 exposes toJSONSchema(); arktype exposes toJsonSchema(). Duck-typing
  // both keeps this package dependency-free.
  const candidate = input as { toJSONSchema?: () => object; toJsonSchema?: () => object }
  if (typeof candidate.toJSONSchema === 'function') {return candidate.toJSONSchema() as Record<string, unknown>}
  if (typeof candidate.toJsonSchema === 'function') {return candidate.toJsonSchema() as Record<string, unknown>}
  if (isStandardSchema(input)) {
    throw new TypeError(
      `Cannot derive a JSON Schema from "${input['~standard'].vendor}". Pass a JSON Schema object as \`input\` instead.`,
    )
  }
  return input as Record<string, unknown>
}

async function validate(schema: InputSchema | undefined, value: unknown) {
  if (!schema) {return { value }}
  if (!isStandardSchema(schema)) {
    // A raw JSON Schema is a description, not a validator — nothing here parses
    // it. Checking the top-level `required` list covers the failure that
    // actually bites: a handler dereferencing a property the agent omitted.
    // ponytail: top-level `required` only. Use a Standard Schema (zod, arktype,
    // valibot) when nested or format validation matters.
    const required = (schema as { required?: unknown }).required
    if (Array.isArray(required)) {
      const record = (typeof value === 'object' && value !== null ? value : {}) as Record<string, unknown>
      const missing = required.filter((key) => typeof key === 'string' && record[key] === undefined)
      if (missing.length > 0) {
        return { error: `Invalid input — missing required: ${missing.join(', ')}` }
      }
    }
    return { value }
  }
  const result = await schema['~standard'].validate(value)
  if (result.issues) {
    const detail = result.issues
      .map((i) => `${i.path?.map((p) => (typeof p === 'object' ? p.key : p)).join('.') ?? ''}: ${i.message}`)
      .join('; ')
    return { error: `Invalid input — ${detail}` }
  }
  return { value: result.value }
}

/**
 * `T` maps each tool name to its input schema. TypeScript reverse-infers it
 * from the `input` property of each entry, which is what contextually types
 * that entry's `handler` argument.
 */
/**
 * The one place the input type is erased.
 *
 * Callers get `handler(input: Infer<S>)` from the public overload, but inside
 * the implementation `S` is erased to the union, so the two cannot be related
 * by inference. This is sound because it is only reached after the schema has
 * validated the value: see `validate` above, whose failure path returns before
 * the handler is called.
 */
const validated = (value: unknown) => value as never

const availability = (def: ToolDef): boolean | string => def.when?.() ?? true

/** `undefined` while the tool may run; otherwise the text the agent gets back. */
const refusal = (name: string, state: boolean | string) =>
  state === true ? undefined : state || `${name} is not available right now.`

/**
 * The fields the browser hands an agent. If any of them changes, the descriptor
 * the user consented to is no longer the one that is registered, so the tool has
 * to be replaced rather than left alone.
 */
export const descriptorKey = (name: string, def: ToolDef): string =>
  JSON.stringify([
    name,
    def.title,
    def.description,
    toJsonSchema(def.input),
    def.annotations,
    def.exposedTo,
  ])

export function tools<T extends Record<string, InputSchema | undefined>>(
  defs: { [K in keyof T]: ToolDef<T[K]> },
): Registry
export function tools(defs: Record<string, ToolDef>): Registry {
  // One controller per tool: aborting it is how the platform unregisters.
  // The key is the descriptor it was registered with, so `sync` can tell a
  // tool that merely still exists from one that still matches.
  const live = new Map<string, { controller: AbortController; key: string }>()

  async function add(name: string, def: ToolDef, key: string) {
    const controller = new AbortController()
    live.set(name, { controller, key })
    try {
      await modelContext().registerTool(
        {
          description: def.description,
          name,
          ...(def.title !== undefined && { title: def.title }),
          inputSchema: toJsonSchema(def.input),
          ...(def.annotations && { annotations: def.annotations }),
          execute: async (raw: unknown, options: { signal: AbortSignal }) => {
            const parsed = await validate(def.input, raw)
            // Chrome discards thrown messages, so a validation failure has to be
            // *returned* as text or the agent learns nothing.
            if ('error' in parsed) {return parsed.error}
            return toToolResult(() => {
              // `when` is what makes the tool list mirror the UI. Checking it
              // only at registration leaves a window between revalidations
              // where a tool the user can no longer reach is still callable.
              const why = refusal(name, availability(def))
              if (why) {
                // Refuse only. Unregistering here would abort this tool's
                // registration while the call is still in flight, and Chrome
                // fails the whole invocation with a transient UnknownError
                // instead of delivering this message. The list corrects itself
                // on the next revalidate, which every adapter already drives.
                return why
              }
              return def.handler(validated(parsed.value), options)
            })
          },
        } as WebMCP.ModelContextTool,
        {
          signal: controller.signal,
          ...(def.exposedTo && { exposedTo: def.exposedTo }),
        },
      )
    } catch (error) {
      if (live.get(name)?.controller === controller) {live.delete(name)}
      throw error
    }
  }

  function remove(name: string) {
    live.get(name)?.controller.abort()
    live.delete(name)
  }

  async function sync() {
    // Applications can ship one bundle to browsers with and without WebMCP.
    // A later revalidate() will register the tools if the API becomes available.
    if (typeof document === 'undefined' || !document.modelContext) {return}
    for (const [name, def] of Object.entries(defs)) {
      const entry = live.get(name)
      // Only an outright `false` takes the tool away. A reason string keeps it
      // listed, so the agent can still call it and be told what is wrong.
      if (availability(def) === false) {
        if (entry) {remove(name)}
        continue
      }
      // A description or schema built from application state can change without
      // the name changing. Reconciling on the name alone leaves the agent
      // reading the descriptor this tool had at mount time, forever.
      const key = descriptorKey(name, def)
      if (!entry) {await add(name, def, key)}
      else if (entry.key !== key) {
        remove(name)
        await add(name, def, key)
      }
    }
  }

  return {
    mount: sync,
    revalidate: sync,
    unmount() {
      // Copy first: `remove` deletes from `live` while we iterate it.
      // oxlint-disable-next-line no-useless-spread
      for (const name of [...live.keys()]) {remove(name)}
    },
  }
}
