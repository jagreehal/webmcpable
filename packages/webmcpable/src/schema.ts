/**
 * Read a RegisteredTool's input schema.
 *
 * The draft types this as `object` (index.bs:1207) and webmcp-types agrees,
 * but Chrome returns a JSON string (measured in 151 and 152). Code that does
 * `tool.inputSchema.properties` silently gets undefined. Always go through
 * this. See spike/SPIKE-FINDINGS.md.
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
