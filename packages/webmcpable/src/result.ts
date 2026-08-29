/**
 * Normalises a handler's return value into what Chrome actually delivers to
 * the agent. Every rule here is measured, not inferred — see spike/SPIKE-FINDINGS.md.
 */
export type Handler<T> = () => T | Promise<T>

export async function toToolResult(handler: Handler<unknown>): Promise<string> {
  let value: unknown
  try {
    value = await handler()
  } catch (error) {
    // Chrome replaces a thrown error with a generic UnknownError and drops the
    // message. Returning the text is the only way the agent learns what broke.
    return `Error: ${error instanceof Error ? error.message : String(error)}`
  }

  if (typeof value === 'string') {return value}
  // Chrome serialises `undefined` to the literal string "undefined".
  if (value === undefined) {return ''}
  return JSON.stringify(value) ?? ''
}
