import { describe, expect, it } from 'vitest'
import { exampleInput } from './example'

const parse = (s: string) => JSON.parse(s) as Record<string, unknown>

describe('exampleInput', () => {
  it('returns an empty object when there is no schema', () => {
    expect(exampleInput(undefined)).toBe('{}')
  })

  it('fills required properties by type', () => {
    expect(
      parse(
        exampleInput({
          properties: { b: { type: 'boolean' }, n: { type: 'number' }, q: { type: 'string' } },
          required: ['q', 'n', 'b'],
          type: 'object',
        }),
      ),
    ).toEqual({ b: false, n: 0, q: '' })
  })

  it('uses the first enum value when there is one', () => {
    expect(parse(exampleInput({
      properties: { size: { enum: ['S', 'M', 'L'], type: 'string' } },
      required: ['size'],
      type: 'object',
    }))).toEqual({ size: 'S' })
  })

  it('prefers an explicit example or default', () => {
    expect(parse(exampleInput({
      properties: {
        a: { examples: ['blue shoes'], type: 'string' },
        b: { default: 10, type: 'number' },
      },
      required: ['a', 'b'],
      type: 'object',
    }))).toEqual({ a: 'blue shoes', b: 10 })
  })

  it('includes optional properties too, so they can be edited in place', () => {
    expect(parse(exampleInput({
      properties: { limit: { type: 'number' }, q: { type: 'string' } },
      required: ['q'],
      type: 'object',
    }))).toEqual({ limit: 0, q: '' })
  })

  it('handles arrays and nested objects', () => {
    expect(parse(exampleInput({
      properties: {
        tags: { items: { type: 'string' }, type: 'array' },
        who: { properties: { name: { type: 'string' } }, required: ['name'], type: 'object' },
      },
      required: ['tags', 'who'],
      type: 'object',
    }))).toEqual({ tags: [''], who: { name: '' } })
  })

  it('accepts a schema handed back as a JSON string, as Chrome does', () => {
    expect(parse(exampleInput('{"type":"object","properties":{"q":{"type":"string"}}}'))).toEqual({
      q: '',
    })
  })

  it('produces valid JSON even for an unrecognised schema', () => {
    expect(() => parse(exampleInput({ nonsense: true }))).not.toThrow()
  })
})
