import { toJsonSchema, toolExecutor, type InputSchema, type RegistryOptions, type ToolDef } from './tools'

/**
 * A tool in the shape Chrome's Prompt API takes:
 * `LanguageModel.create({ tools })`. The same four fields the WebMCP draft
 * uses, with `inputSchema` already a JSON Schema object and `execute` already
 * returning the JSON string the explainer asks for.
 */
export interface LocalTool {
  description: string
  execute: (input: unknown) => Promise<string>
  inputSchema: Record<string, unknown>
  name: string
}

// The Prompt API hands `execute` the arguments and nothing else, so there is no
// per-call signal to forward. A never-aborted one keeps handlers written for
// `tools()` working unchanged.
const noSignal = new AbortController().signal

/**
 * The same tool definitions `tools()` registers with `document.modelContext`,
 * in the shape the on-device Prompt API wants.
 *
 * One declaration, both directions: a remote agent calling in through WebMCP,
 * and Gemini Nano running inside the page. `when`, input validation and the
 * `confirm` gate behave identically on both paths.
 *
 * ```ts
 * const session = await LanguageModel.create({ tools: localTools(defs) })
 * ```
 *
 * Unlike a `Registry` there is nothing to revalidate: the array is a snapshot
 * of what `when` allowed when it was built, and a session holds the tools it
 * was created with. Build it again per `create()` — or per `clone()` — to pick
 * up a change. A tool whose `when` turns false afterwards still refuses at call
 * time, so a stale array cannot run something the user can no longer do.
 */
export function localTools<T extends Record<string, InputSchema | undefined>>(
  defs: { [K in keyof T]: ToolDef<T[K]> },
  options?: RegistryOptions,
): Array<LocalTool>
export function localTools(
  defs: Record<string, ToolDef>,
  options: RegistryOptions = {},
): Array<LocalTool> {
  return Object.entries(defs).flatMap(([name, def]) => {
    // `false` takes the tool away; a reason string keeps it listed so the model
    // is told why, exactly as on the WebMCP path.
    if (def.when?.() === false) {return []}
    const execute = toolExecutor(name, def, options)
    return [
      {
        description: def.description,
        execute: (input: unknown) => execute(input, { signal: noSignal }),
        inputSchema: toJsonSchema(def.input),
        name,
      },
    ]
  })
}
