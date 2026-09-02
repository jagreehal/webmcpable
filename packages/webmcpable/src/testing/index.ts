import { modelContext } from '../model-context'
import { isPotentiallyTrustworthyOrigin } from '../origin'
import { readInputSchema } from '../schema'

/**
 * An in-memory `document.modelContext` that reproduces Chrome's real
 * behaviour — including its divergences from the W3C draft.
 *
 * Every quirk here is measured, not inferred. See spike/SPIKE-FINDINGS.md.
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

/** Chrome keeps only these two, and always returns both once any are sent. */
const normaliseAnnotations = (annotations: Record<string, unknown>) => ({
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
  const calls: Array<RecordedCall> = []
  const previous = Object.getOwnPropertyDescriptor(document, 'modelContext')

  const target = new EventTarget()

  const modelContext = {
    addEventListener: target.addEventListener.bind(target),
    dispatchEvent: target.dispatchEvent.bind(target),
    async executeTool(tool: { name: string }, inputArguments: string) {
      const entry = registry.get(tool.name)
      if (!entry) {throw new DOMException('Tool not found', 'NotFoundError')}

      // Chrome requires a JSON *string* here and rejects objects.
      // wpt: object-arguments.https.html — the argument is a JSON *string*, and
      // must parse to an object or an array. JSON primitives are rejected.
      let input: unknown
      try {
        if (typeof inputArguments !== 'string') {throw new Error('not a string')}
        input = JSON.parse(inputArguments)
        if (typeof input !== 'object' || input === null) {throw new Error('not an object')}
      } catch {
        throw new DOMException('Failed to parse input arguments', 'UnknownError')
      }

      let value: unknown
      try {
        // One argument. Measured in Chrome 152 (e2e/cdp.conformance.ts): the
        // browser calls a registered `execute` with the input and nothing
        // else. Handing the handler a second argument here would hide the very
        // gap webmcpable exists to close.
        value = await entry.execute(input)
      } catch {
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
      //  - `inputSchema` comes back as a JSON *string*, not an object
      //  - `title` defaults to an empty string
      //  - unknown annotations are stripped, the known two normalised
      // wpt: getTools.https.html — tools come back in lexicographical order,
      // not the order they were registered in.
      return [...registry.values()]
        .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
        .map((t) => ({
          description: t.description,
          inputSchema:
            typeof t.inputSchema === 'string' ? t.inputSchema : JSON.stringify(t.inputSchema),
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
      if (tool.inputSchema !== undefined) {
        try {
          JSON.stringify(tool.inputSchema)
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
 * carries its owner Window and throws on a circular structure, and Chrome hands
 * `inputSchema` back as a JSON string.
 */
export async function toolSchemas(): Promise<{
  tools: Array<{ description: string; inputSchema: Record<string, unknown>; name: string }>
}> {
  const listed = await modelContext().getTools()
  return {
    tools: listed.map((tool) => ({
      description: tool.description,
      inputSchema: readInputSchema(tool.inputSchema) ?? { properties: {}, type: 'object' },
      name: tool.name,
    })),
  }
}
