/**
 * Build a plausible argument object from a tool's input schema, so the debug
 * panel opens with something runnable instead of `{}` — which just produces a
 * validation error on every tool that takes arguments.
 */

import { readInputSchema } from '../schema'

type Schema = Record<string, unknown>

const asSchema = readInputSchema

function sample(schema: Schema, depth = 0): unknown {
  if (depth > 4) {return null}

  if ('default' in schema) {return schema['default']}
  const examples = schema['examples']
  if (Array.isArray(examples) && examples.length > 0) {return examples[0]}
  const enumValues = schema['enum']
  if (Array.isArray(enumValues) && enumValues.length > 0) {return enumValues[0]}

  switch (schema['type']) {
    case 'string':
      return ''
    case 'number':
    case 'integer':
      return 0
    case 'boolean':
      return false
    case 'null':
      return null
    case 'array': {
      const items = asSchema(schema['items'])
      return items ? [sample(items, depth + 1)] : []
    }
    case 'object':
      return object(schema, depth + 1)
    default:
      return null
  }
}

function object(schema: Schema, depth: number): Record<string, unknown> {
  const properties = asSchema(schema['properties'])
  if (!properties) {return {}}

  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(properties)) {
    const property = asSchema(value)
    // Optional properties are included too: easier to delete a line than to
    // remember the property name and its shape.
    if (property) {out[key] = sample(property, depth)}
  }
  return out
}

export function exampleInput(schema: unknown): string {
  const parsed = asSchema(schema)
  if (!parsed) {return '{}'}
  return JSON.stringify(object(parsed, 0))
}
