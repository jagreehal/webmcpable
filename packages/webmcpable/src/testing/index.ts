import { modelContext } from '../model-context'
import { isPotentiallyTrustworthyOrigin } from '../origin'
import { readInputSchema } from '../schema'

/**
 * An in-memory `document.modelContext` that reproduces Chrome's real
 * behaviour — including its divergences from the W3C draft.
 *
 * Every quirk here is measured in e2e/CHROME-CONFORMANCE.md.
 * This is what lets tools run in tests and CI with no browser flag.
 */

export interface RecordedCall {
  input: unknown
  name: string
  result: string
}

interface Entry {
  annotations?: Record<string, unknown>
  description: string
  execute: (input: unknown, options?: { signal: AbortSignal }) => unknown
  inputSchema?: unknown
  name: string
  title?: string
}

interface RegisterOptions {
  exposedTo?: Array<string>
  signal?: AbortSignal
}

const VALID_TOOL_NAME = /^[A-Za-z0-9_.-]{1,128}$/

/**
 * Chrome returns these three, and always returns all three once any are
 * sent. Chrome 155 drops `debugging`, and 156 returns it.
 */
const normaliseAnnotations = (annotations: Record<string, unknown>) => ({
  consequentialHint: annotations['consequentialHint'] === true,
  readOnlyHint: annotations['readOnlyHint'] === true,
  untrustedContentHint: annotations['untrustedContentHint'] === true,
})

export interface TestModelContext {
  /** Every tool invocation, in order — assert on what the agent actually did. */
  calls: Array<RecordedCall>
  /** Remove the fake and restore whatever was there before. */
  uninstall(): void
}

export function installTestModelContext(): TestModelContext {
  const registry = new Map<string, Entry>()
  // Chrome snapshots the schema as JSON at registration, so `toJSON` and later
  // mutation both resolve then. Kept beside the tool so its prototype survives.
  const schemas = new WeakMap<Entry, string>()
  const calls: Array<RecordedCall> = []
  const previous = Object.getOwnPropertyDescriptor(document, 'modelContext')

  const target = new EventTarget()

  const modelContext = {
    addEventListener: target.addEventListener.bind(target),
    dispatchEvent: target.dispatchEvent.bind(target),
    async executeTool(
      tool: { name: string },
      inputArguments: object = {},
      options?: { signal?: AbortSignal },
    ) {
      const entry = registry.get(tool.name)
      if (!entry) {throw new DOMException('Tool not found', 'NotFoundError')}

      // Chrome 155 takes an object (or array) and rejects anything else,
      // including the JSON string 152-154 required. Omitted input is `{}`.
      if (typeof inputArguments !== 'object' || inputArguments === null) {
        throw new TypeError(
          "Failed to execute 'executeTool' on 'ModelContext': invalid input object: value is not an object",
        )
      }
      // Chrome serialises the input through JSON, so a Date arrives as a string,
      // NaN as null, undefined properties vanish, and a cycle or BigInt throws.
      let json: string | undefined
      try {
        json = JSON.stringify(inputArguments)
        if (json === undefined) {throw new TypeError('value is not an object')}
      } catch (error) {
        throw new TypeError(
          `Failed to execute 'executeTool' on 'ModelContext': ${(error as Error).message}`,
          { cause: error },
        )
      }
      // oxlint-disable-next-line unicorn/prefer-structured-clone -- Chrome's semantics are JSON's, not structuredClone's
      const input: unknown = JSON.parse(json)

      if (options?.signal?.aborted) {throw options.signal.reason}

      let value: unknown
      try {
        // Chrome passes `(input, { signal })`. Aborting the caller's signal
        // rejects `executeTool` but leaves the handler's signal untouched; only
        // a CDP cancel aborts it, and the fake has no CDP.
        const running = Promise.resolve(entry.execute(input, { signal: new AbortController().signal }))
        const { signal } = options ?? {}
        value = await (signal
          ? Promise.race([
              running,
              new Promise((_, reject) =>
                signal.addEventListener('abort', () => reject(signal.reason), { once: true }),
              ),
            ])
          : running)
      } catch (error) {
        if (options?.signal?.aborted && error === options.signal.reason) {throw error}
        // Chrome discards the original message. Reproduce that, so nobody
        // builds an error strategy that only works in tests.
        throw new DOMException(
          'Tool was executed but the invocation failed. For example, the script function threw an error',
          'UnknownError',
        )
      }

      const serialised = typeof value === 'string' ? value : String(JSON.stringify(value))
      // Chrome substitutes a canned message for an empty result — and only for
      // the empty string. Whitespace, 0, false and null pass through.
      const result = serialised === '' ? 'Operation succeeded' : serialised
      calls.push({ input, name: entry.name, result })
      return result
    },

    async getTools() {
      // Reproduce Chrome's RegisteredTool exactly, quirks included:
      //  - `window` makes it circular, so JSON.stringify throws
      //  - `inputSchema` is parsed from the JSON taken at registration
      //  - `title` defaults to an empty string
      //  - unknown annotations and `debugging` are stripped, the other three normalised
      // wpt: getTools.https.html — tools come back in lexicographical order,
      // not the order they were registered in.
      return [...registry.values()]
        .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
        .map((t) => ({
          description: t.description,
          inputSchema: schemas.has(t) ? JSON.parse(schemas.get(t)!) : undefined,
          name: t.name,
          origin: location.origin,
          title: t.title ?? '',
          ...(t.annotations ? { annotations: normaliseAnnotations(t.annotations) } : {}),
          window,
        }))
    },

    async registerTool(tool: Entry, options?: RegisterOptions) {
      if (!VALID_TOOL_NAME.test(tool.name)) {
        throw new DOMException(
          'Tool name must use 1-128 ASCII letters, digits, underscores, hyphens, or dots',
          'InvalidStateError',
        )
      }
      if (typeof tool.description !== 'string' || tool.description.length === 0) {
        throw new DOMException('Tool description must be a non-empty string', 'InvalidStateError')
      }
      if (typeof tool.execute !== 'function') {
        // Measured in Chrome 152: `execute` is a required WebIDL member, so a
        // non-function fails at the binding layer with a TypeError, not the
        // InvalidStateError the other registration checks throw.
        throw new TypeError(
          "Failed to execute 'registerTool' on 'ModelContext': Failed to read the 'execute' property from 'ModelContextTool': The given value is not a function.",
        )
      }
      if (registry.has(tool.name)) {
        throw new DOMException(`A tool named "${tool.name}" is already registered`, 'InvalidStateError')
      }
      let schemaJson: string | undefined
      if (tool.inputSchema !== undefined) {
        try {
          schemaJson = JSON.stringify(tool.inputSchema)
        } catch {
          throw new TypeError('Tool inputSchema must be JSON-serializable')
        }
      }
      for (const origin of options?.exposedTo ?? []) {
        if (!isPotentiallyTrustworthyOrigin(origin)) {
          throw new DOMException(`exposedTo origin "${origin}" is not trustworthy`, 'SecurityError')
        }
      }
      if (options?.signal?.aborted) {throw options.signal.reason}

      registry.set(tool.name, tool)
      if (schemaJson !== undefined) {schemas.set(tool, schemaJson)}
      options?.signal?.addEventListener('abort', () => {
        registry.delete(tool.name)
        target.dispatchEvent(new Event('toolchange'))
      })
      target.dispatchEvent(new Event('toolchange'))
    },

    removeEventListener: target.removeEventListener.bind(target),
  }

  Object.defineProperty(document, 'modelContext', { configurable: true, value: modelContext })

  return {
    calls,
    uninstall() {
      if (previous) {Object.defineProperty(document, 'modelContext', previous)}
      else {delete (document as { modelContext?: unknown }).modelContext}
    },
  }
}

/**
 * The registered tools in the shape `webmcp-evals local -t schema.json` reads.
 *
 *   const mc = installTestModelContext()
 *   await registry.mount()
 *   writeFileSync('schema.json', JSON.stringify(await toolSchemas(), null, 2))
 *
 * `JSON.stringify(await getTools())` cannot stand in for this: a RegisteredTool
 * carries its owner Window and throws on a circular structure.
 */
export async function toolSchemas(): Promise<{
  tools: Array<{
    annotations?: WebMCP.ToolAnnotations
    description: string
    inputSchema: Record<string, unknown>
    name: string
  }>
}> {
  const listed = await modelContext().getTools()
  return {
    tools: listed.map((tool) => ({
      ...(tool.annotations && { annotations: tool.annotations }),
      description: tool.description,
      inputSchema: readInputSchema(tool.inputSchema) ?? { properties: {}, type: 'object' },
      name: tool.name,
    })),
  }
}
