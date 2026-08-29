import { describe, expectTypeOf, it } from 'vitest'
import * as z from 'zod'
import { tools } from './tools'

// Inference here is fragile — it relies on reverse-mapped-type inference so
// each handler's argument is contextually typed from its sibling `input`.
// These assertions fail at typecheck time if that breaks.
describe('tools() inference', () => {
  it('types the handler argument from the tool\'s own input schema', () => {
    tools({
      search: {
        description: 'search',
        handler: (input) => {
          expectTypeOf(input).toEqualTypeOf<{ limit?: number | undefined; q: string; }>()
          return ''
        },
        input: z.object({ limit: z.number().optional(), q: z.string() }),
      },
    })
  })

  it('infers each tool independently within one call', () => {
    tools({
      a: {
        description: 'a',
        handler: (input) => {
          expectTypeOf(input).toEqualTypeOf<{ x: string }>()
          return ''
        },
        input: z.object({ x: z.string() }),
      },
      b: {
        description: 'b',
        handler: (input) => {
          expectTypeOf(input).toEqualTypeOf<{ y: number }>()
          return ''
        },
        input: z.object({ y: z.number() }),
      },
    })
  })

  it('passes an AbortSignal for per-invocation cancellation', () => {
    tools({
      slow: {
        description: 'slow',
        handler: (_input, options) => {
          expectTypeOf(options.signal).toEqualTypeOf<AbortSignal>()
          return ''
        },
      },
    })
  })
})
