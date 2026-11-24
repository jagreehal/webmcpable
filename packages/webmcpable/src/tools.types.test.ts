import { describe, expectTypeOf, it } from 'vitest'
import * as z from 'zod'
import { localTools } from './local'
import { useTools as useReactTools } from './react/index'
import { tools } from './tools'
import { useTools as useVueTools } from './vue/index'

// Inference here is fragile — it relies on reverse-mapped-type inference so
// each handler's argument is contextually typed from its sibling `input`.
// These assertions fail at typecheck time if that breaks.
describe('tools() inference', () => {
  it('types the handler argument from the tool\'s own input schema', () => {
    tools({
      search: {
        description: 'search',
        execute: (input) => {
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
        execute: (input) => {
          expectTypeOf(input).toEqualTypeOf<{ x: string }>()
          return ''
        },
        input: z.object({ x: z.string() }),
      },
      b: {
        description: 'b',
        execute: (input) => {
          expectTypeOf(input).toEqualTypeOf<{ y: number }>()
          return ''
        },
        input: z.object({ y: z.number() }),
      },
    })
  })

  it('keeps a tool\'s input type beside a tool that declares none', () => {
    tools({
      search: {
        description: 'search',
        execute: (input) => {
          expectTypeOf(input).toEqualTypeOf<{ q: string }>()
          return ''
        },
        input: z.object({ q: z.string() }),
        outputSchema: z.object({ n: z.number() }),
      },
      view: {
        annotations: { readOnlyHint: true },
        description: 'view',
        execute: (input) => {
          expectTypeOf(input).toEqualTypeOf<Record<string, unknown>>()
          return ''
        },
      },
      raw: {
        description: 'raw',
        execute: (input) => {
          expectTypeOf(input).toEqualTypeOf<Record<string, unknown>>()
          return ''
        },
        input: { properties: { q: { type: 'string' } }, type: 'object' },
      },
    })
  })

  it('keeps it through the adapters', () => {
    const search = z.object({ q: z.string() })
    const view = { description: 'view', execute: () => '' }
    // Checked by the compiler, never called: the hooks need a component.
    const check = () => {
      localTools({ search: { description: 'search', execute: ({ q }) => q.length, input: search }, view })
      useReactTools({ search: { description: 'search', execute: ({ q }) => q.length, input: search }, view })
      useVueTools({ search: { description: 'search', execute: ({ q }) => q.length, input: search }, view })
    }
    expectTypeOf(check).toBeFunction()
  })

  it('rejects an input that is not a schema', () => {
    tools({
      // @ts-expect-error a number is not a schema
      search: { description: 'search', execute: () => '', input: 5 },
    })
  })

  it('passes an AbortSignal for per-invocation cancellation', () => {
    tools({
      slow: {
        description: 'slow',
        execute: (_input, options) => {
          expectTypeOf(options.signal).toEqualTypeOf<AbortSignal>()
          return ''
        },
      },
    })
  })
})
