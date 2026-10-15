/**
 * Read a RegisteredTool's input schema.
 *
 * The draft types this as `object` (index.bs:1207). Chrome 155 agrees, but
 * 151-154 returned a JSON string, so `tool.inputSchema.properties` silently
 * got undefined there. Going through this copes with both.
 */
export function readInputSchema(schema: unknown): Record<string, unknown> | undefined {
  if (typeof schema === 'string') {
    try {
      return JSON.parse(schema) as Record<string, unknown>
    } catch {
      return undefined
    }
  }
  return typeof schema === 'object' && schema !== null ? (schema as Record<string, unknown>) : undefined
}
