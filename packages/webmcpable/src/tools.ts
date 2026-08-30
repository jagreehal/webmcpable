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
  execute: (input: Infer<S>, options: { signal: AbortSignal }) => unknown
  /** Origins in the current document tree that may discover and call this tool. */
  exposedTo?: Array<string>
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

/** The call the execute wrapper is about to run — name and args, not the label. */
export interface ConfirmCall {
  description: string
  /** True when the descriptor has moved since this tool was first registered. */
  descriptorChanged: boolean
  input: unknown
  name: string
  title?: string
}

export interface RegistryOptions {
  /**
   * Ask before a mutating tool runs. `true` uses `window.confirm`.
   * Tools with `readOnlyHint: true` skip this.
   */
  confirm?: boolean | ((call: ConfirmCall) => boolean | Promise<boolean>) | undefined
  /** Never send `title` to the browser, so a consent dialogue cannot promote a friendlier label. */
  titles?: 'off' | undefined
}

/**
 * A schema may validate to something JSON cannot hold — a BigInt, a Map, a
 * cycle. This is the text a user approves a call by, so each of those has to
 * show its contents rather than throw or serialise to `{}`.
 */
// oxlint-disable-next-line @nkzw/no-instanceof -- Map and Set are the point
function describeInput(input: unknown): string {
  const seen = new WeakSet<object>()
  try {
    return (
      JSON.stringify(input, (_, value: unknown) => {
        if (typeof value === 'bigint') {return `${value}`}
        // oxlint-disable-next-line @nkzw/no-instanceof
        if (value instanceof Map) {return Object.fromEntries(value)}
        // oxlint-disable-next-line @nkzw/no-instanceof
        if (value instanceof Set) {return [...value]}
        if (typeof value === 'object' && value !== null) {
          if (seen.has(value)) {return '[circular]'}
          seen.add(value)
        }
        return value
      }) ?? ''
    )
  } catch {
    return String(input)
  }
}

export function formatConfirmPrompt(call: ConfirmCall): string {
  const headline = `${call.name} ${describeInput(call.input)}`
  const subtitle = call.title ?? call.description
  return call.descriptorChanged
    ? `${headline}\n${subtitle}\nThis tool has changed since page load.`
    : `${headline}\n${subtitle}`
}

export async function invokeConfirm(
  confirm: RegistryOptions['confirm'],
  call: ConfirmCall,
): Promise<boolean> {
  // `false` is "do not ask", not "ask with the default dialogue" — a caller
  // writing `confirm: isProduction` must be silent when that is false.
  if (confirm === undefined || confirm === false) {return true}
  if (typeof confirm === 'function') {return confirm(call)}
  if (typeof globalThis.confirm === 'function') {return globalThis.confirm(formatConfirmPrompt(call))}
  return false
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
    // Top-level `required` only. Use a Standard Schema (zod, arktype, valibot)
    // when nested or format validation matters.
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
 * that entry's `execute` argument.
 */
/**
 * The one place the input type is erased.
 *
 * Callers get `execute(input: Infer<S>)` from the public overload, but inside
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

/** The title the browser will actually see: `titles: 'off'` withholds it. */
export const effectiveTitle = (
  def: ToolDef,
  titles: RegistryOptions['titles'],
): string | undefined => (titles === 'off' ? undefined : def.title)

/**
 * The fields the browser hands an agent. If any of them changes, the descriptor
 * the user consented to is no longer the one that is registered, so the tool has
 * to be replaced rather than left alone.
 *
 * The title is the effective one, not the declared one: switching `titles` off
 * changes what the browser holds, so it has to change the key that decides
 * whether to re-register.
 */
export const descriptorKey = (
  name: string,
  def: ToolDef,
  titles?: RegistryOptions['titles'],
): string =>
  JSON.stringify([
    name,
    effectiveTitle(def, titles),
    def.description,
    toJsonSchema(def.input),
    def.annotations,
    def.exposedTo,
  ])

/**
 * Everything that happens between an agent choosing a tool and the handler
 * running: validate, re-check `when`, ask the user, flatten the result.
 *
 * Shared so the on-device Prompt API path (`webmcpable/local`) refuses and
 * confirms exactly like the WebMCP one. A tool the user cannot reach must not
 * become reachable because the model asking for it happens to live in the page.
 */
export function toolExecutor(
  name: string,
  def: ToolDef,
  options: RegistryOptions = {},
  descriptorChanged: () => boolean = () => false,
): (input: unknown, callOptions: { signal: AbortSignal }) => Promise<string> {
  const title = effectiveTitle(def, options.titles)
  return async (raw, callOptions) => {
    const parsed = await validate(def.input, raw)
    // Chrome discards thrown messages, so a validation failure has to be
    // *returned* as text or the agent learns nothing.
    if ('error' in parsed) {return parsed.error}
    return toToolResult(async () => {
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
      if (def.annotations?.readOnlyHint !== true && options.confirm) {
        const ok = await invokeConfirm(options.confirm, {
          description: def.description,
          descriptorChanged: descriptorChanged(),
          input: parsed.value,
          name,
          ...(title !== undefined && { title }),
        })
        if (!ok) {return `${name} was not confirmed.`}
      }
      return def.execute(validated(parsed.value), callOptions)
    })
  }
}

export function tools<T extends Record<string, InputSchema | undefined>>(
  defs: { [K in keyof T]: ToolDef<T[K]> },
  options?: RegistryOptions,
): Registry
export function tools(defs: Record<string, ToolDef>, options: RegistryOptions = {}): Registry {
  // One controller per tool: aborting it is how the platform unregisters.
  // The key is the descriptor it was registered with, so `sync` can tell a
  // tool that merely still exists from one that still matches.
  const live = new Map<string, { controller: AbortController; key: string }>()
  // First descriptor seen for each name, so confirm can flag a swap since load.
  const firstSeen = new Map<string, string>()

  async function add(name: string, def: ToolDef, key: string) {
    const controller = new AbortController()
    live.set(name, { controller, key })
    try {
      const title = effectiveTitle(def, options.titles)
      await modelContext().registerTool(
        {
          description: def.description,
          name,
          ...(title !== undefined && { title }),
          inputSchema: toJsonSchema(def.input),
          ...(def.annotations && { annotations: def.annotations }),
          execute: toolExecutor(name, def, options, () =>
            firstSeen.get(name) !== descriptorKey(name, def, options.titles),
          ),
        } as WebMCP.ModelContextTool,
        {
          signal: controller.signal,
          ...(def.exposedTo && { exposedTo: def.exposedTo }),
        },
      )
      if (!firstSeen.has(name)) {firstSeen.set(name, key)}
    } catch (error) {
      if (live.get(name)?.controller === controller) {live.delete(name)}
      // Chrome refuses a name it already has with "Duplicate tool name" and
      // never says which one, and a `<form toolname>` is a claimant too.
      // Measured in e2e/declarative.conformance.ts.
      throw new Error(
        `webmcpable could not register "${name}": ${error instanceof Error ? `${error.name}: ${error.message}` : String(error)}`,
        { cause: error },
      )
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
    // A definition that is gone takes its registration with it, so an adapter
    // can hand over a changing set of tools without rebuilding the registry —
    // and losing what the user has already been offered.
    const defined = new Set(Object.keys(defs))
    // Copy first: `remove` deletes from `live` while we iterate it.
    // oxlint-disable-next-line no-useless-spread
    for (const name of [...live.keys()]) {
      if (!defined.has(name)) {remove(name)}
    }
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
      const key = descriptorKey(name, def, options.titles)
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
      firstSeen.clear()
    },
  }
}
