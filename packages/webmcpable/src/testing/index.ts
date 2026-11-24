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
  outputSchema?: unknown
  title?: string
}

/** One `registerTool` call. Its identity stands in for Chrome's internal tool ID. */
interface Registration {
  inputSchema: string | undefined
  outputSchema: string | undefined
  tool: Entry
}

interface RegisterOptions {
  exposedTo?: Array<string>
  signal?: AbortSignal
}

const VALID_TOOL_NAME = /^[A-Za-z0-9_.-]{1,128}$/

/** Chrome returns these four, and returns all four once any are sent. */
const normaliseAnnotations = (annotations: Record<string, unknown>) => ({
  consequentialHint: annotations['consequentialHint'] === true,
  debugging: annotations['debugging'] === true,
  readOnlyHint: annotations['readOnlyHint'] === true,
  untrustedContentHint: annotations['untrustedContentHint'] === true,
})

/** Chrome snapshots a schema as JSON at registration, so `toJSON` and later mutation both resolve then. */
const schemaJson = (tool: Entry, member: 'inputSchema' | 'outputSchema'): string | undefined => {
  try {
    return JSON.stringify(tool[member])
  } catch {
    throw new TypeError(`Tool ${member} must be JSON-serializable`)
  }
}

const parseSchema = (json: string | undefined): object | null =>
  json === undefined ? null : (JSON.parse(json) as object)

/** Chrome 160's `Tool`: readable, but JSON.stringify gives `{}` and spread copies nothing. */
const createTool = (members: Omit<WebMCP.Tool, 'window'>): WebMCP.Tool => {
  const tool = {}
  for (const [key, value] of Object.entries(members)) {Object.defineProperty(tool, key, { value })}
  // structuredClone rejects a proxy, the way it rejects Chrome's Tool.
  return new Proxy(tool, {}) as WebMCP.Tool
}

export interface TestModelContext {
  /** Every tool invocation, in order — assert on what the agent actually did. */
  calls: Array<RecordedCall>
  /** Remove the fake and restore whatever was there before. */
  uninstall(): void
}

export function installTestModelContext(): TestModelContext {
  const registry = new Map<string, Registration>()
  const registrations = new WeakMap<object, Registration>()
  const calls: Array<RecordedCall> = []
  const previous = Object.getOwnPropertyDescriptor(document, 'modelContext')

  const target = new EventTarget()

  const modelContext = {
    addEventListener: target.addEventListener.bind(target),
    dispatchEvent: target.dispatchEvent.bind(target),
    async executeTool(
      tool: WebMCP.Tool,
      inputArguments: object = {},
      options?: { signal?: AbortSignal },
    ) {
      const registration = registrations.get(tool)
      if (!registration) {
        throw new TypeError(
          "Failed to execute 'executeTool' on 'ModelContext': parameter 1 is not of type 'Tool'.",
        )
      }
      const entry = registration.tool
      if (registry.get(entry.name) !== registration) {
        throw new DOMException('The requested tool was not found or is not accessible.', 'NotFoundError')
      }

      // Chrome takes an object (or array) and rejects anything else, including
      // the JSON string 152-154 required. Omitted input is `{}`.
      if (typeof inputArguments !== 'object' || inputArguments === null) {
        throw new TypeError(
          "Failed to execute 'executeTool' on 'ModelContext': parameter 2 is not of type 'object'.",
        )
      }
      // Chrome serialises the input through JSON, so a Date arrives as a string,
      // NaN as null, undefined properties vanish, and a cycle or BigInt throws.
      let json: string | undefined
      try {
        json = JSON.stringify(inputArguments)
        if (json === undefined) {throw new TypeError('invalid input object: toJSON() returns undefined')}
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
      // Reproduce Chrome 160's Tool, quirks included:
      //  - schemas are parsed from the JSON taken at registration
      //  - schemas and `annotations` are null when not sent
      //  - `title` defaults to an empty string
      //  - `source` replaces the `window` of 159 and earlier
      //  - unknown annotations are stripped, the four in the draft normalised
      //  - tools come back in lexicographical order
      return [...registry.values()]
        .sort(({ tool: a }, { tool: b }) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
        .map((registration) => {
          const { inputSchema, outputSchema, tool: t } = registration
          const tool = createTool({
            annotations: t.annotations ? normaliseAnnotations(t.annotations) : null,
            description: t.description,
            inputSchema: parseSchema(inputSchema),
            name: t.name,
            origin: location.origin,
            outputSchema: parseSchema(outputSchema),
            source: window,
            title: t.title ?? '',
          })
          registrations.set(tool, registration)
          return tool
        })
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
      const registration: Registration = {
        inputSchema: schemaJson(tool, 'inputSchema'),
        outputSchema: schemaJson(tool, 'outputSchema'),
        tool,
      }
      for (const origin of options?.exposedTo ?? []) {
        if (!isPotentiallyTrustworthyOrigin(origin)) {
          throw new DOMException(`exposedTo origin "${origin}" is not trustworthy`, 'SecurityError')
        }
      }
      if (options?.signal?.aborted) {throw options.signal.reason}

      registry.set(tool.name, registration)
      options?.signal?.addEventListener('abort', () => {
        registry.delete(tool.name)
        target.dispatchEvent(new Event('toolchange'))
      })
      target.dispatchEvent(new Event('toolchange'))
    },

    removeEventListener: target.removeEventListener.bind(target),

    // Chrome handles a rejection here, and getTools() in the page does not wait.
    waitForToolsUntil(promise: Promise<unknown>) {
      void Promise.resolve(promise).catch(() => {})
    },
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
 * `JSON.stringify(await getTools())` gives `{}` for each tool.
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
