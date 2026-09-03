import { existsSync } from 'node:fs'
import type { Page } from '@playwright/test'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { tools } from '../tools'
import { installTestModelContext as installInProcess } from './index'
import { installTestModelContext, type PageModelContext } from './playwright'

/**
 * The helper's real work happens inside `page.evaluate` callbacks, so the fake
 * page below runs them for real against happy-dom rather than recording that
 * they were requested. Everything asserted here is the page-side code actually
 * executing.
 *
 * What it cannot prove is that those callbacks *serialise* — Playwright sends
 * them to a browser as source, so a captured module variable would only fail in
 * a real one. `e2e/bundled-chromium.fixture.ts` is what covers that.
 */
const fakePage = () => {
  const initScripts: Array<string> = []
  const page = {
    addInitScript: async (script: { path: string }) => {
      initScripts.push(script.path)
    },
    evaluate: async (fn: (arg: unknown) => unknown, arg: unknown) => fn(arg),
  }
  return { initScripts, page: page as unknown as Page }
}

describe('webmcpable/testing/playwright', () => {
  let context: PageModelContext
  let initScripts: Array<string>

  beforeEach(async () => {
    window.__webmcpableTesting = installInProcess()
    const fake = fakePage()
    initScripts = fake.initScripts
    context = await installTestModelContext(fake.page)
  })

  const mountCart = () => {
    let total = 0
    return tools({
      add_to_cart: {
        description: 'Add an item to the cart',
        execute: (input) => {
          const { qty = 1, sku } = input as { qty?: number; sku: string }
          total += qty
          return { sku, total }
        },
        input: {
          properties: { qty: { type: 'number' }, sku: { type: 'string' } },
          required: ['sku'],
          type: 'object',
        },
        title: 'Add to cart',
      },
      cart_total: {
        annotations: { readOnlyHint: true },
        description: 'How many items are in the cart',
        execute: () => ({ total }),
      },
      out_of_stock: {
        description: 'Always fails',
        execute: () => {
          throw new Error('the espresso ran out')
        },
      },
    }).mount()
  }

  describe('installTestModelContext', () => {
    it('hands the browser bundle to addInitScript', () => {
      expect(initScripts).toHaveLength(1)
      expect(initScripts[0]).toMatch(/testing-browser\.iife\.js$/)
    })

    // A path that does not resolve fails at goto with a bare ENOENT, long after
    // the cause. The build emits this name; if it ever renames, fail here.
    it('points at a bundle that exists', () => {
      expect(existsSync(initScripts[0]!)).toBe(true)
    })
  })

  describe('getTools', () => {
    it('parses inputSchema, which the browser hands back as a string', async () => {
      await mountCart()
      const [addToCart] = await context.getTools()

      expect(typeof addToCart!.inputSchema).toBe('object')
      expect(addToCart!.inputSchema).toMatchObject({
        properties: { qty: { type: 'number' }, sku: { type: 'string' } },
        required: ['sku'],
        type: 'object',
      })
    })

    it('lists tools name-sorted, not registration-sorted', async () => {
      await mountCart()

      expect((await context.getTools()).map((tool) => tool.name)).toEqual([
        'add_to_cart',
        'cart_total',
        'out_of_stock',
      ])
    })

    it('carries title, origin, and both annotation hints', async () => {
      await mountCart()
      const byName = Object.fromEntries((await context.getTools()).map((t) => [t.name, t]))

      expect(byName['add_to_cart']).toMatchObject({ origin: location.origin, title: 'Add to cart' })
      // Chrome returns both hints once any are sent, so neither is undefined.
      expect(byName['cart_total']!.annotations).toEqual({
        readOnlyHint: true,
        untrustedContentHint: false,
      })
    })

    it('reports an unparseable schema as undefined rather than throwing', async () => {
      await document.modelContext!.registerTool({
        description: 'Registered straight, with a schema the browser cannot parse',
        execute: () => 'ok',
        inputSchema: 'not json' as unknown as Record<string, unknown>,
        name: 'raw',
      })

      expect((await context.getTools())[0]!.inputSchema).toBeUndefined()
    })
  })

  describe('callTool', () => {
    it('serialises an object input to the JSON string Chrome demands', async () => {
      await mountCart()

      expect(await context.callTool('add_to_cart', { qty: 2, sku: 'espresso' })).toBe(
        '{"sku":"espresso","total":2}',
      )
    })

    it('defaults to an empty object, so a no-argument tool needs no input', async () => {
      await mountCart()

      expect(await context.callTool('cart_total')).toBe('{"total":0}')
    })

    it('names the tool when there is no such tool', async () => {
      await mountCart()

      await expect(context.callTool('checkout')).rejects.toThrow(
        'No tool named "checkout" is registered on this page.',
      )
    })

    // Chrome drops a thrown message, so `tools()` returns it as text instead —
    // the agent reads why the call failed rather than watching it reject.
    it('delivers a webmcpable handler’s failure as a result, not a rejection', async () => {
      await mountCart()

      expect(await context.callTool('out_of_stock')).toBe('Error: the espresso ran out')
    })

    it("replaces a raw handler's thrown message with Chrome's canned one", async () => {
      await document.modelContext!.registerTool({
        description: 'Registered straight past webmcpable, and throws',
        execute: () => {
          throw new Error('the espresso ran out')
        },
        name: 'raw_thrower',
      })

      await expect(context.callTool('raw_thrower')).rejects.toThrow(
        'Tool was executed but the invocation failed',
      )
      await expect(context.callTool('raw_thrower')).rejects.not.toThrow('the espresso ran out')
    })

    // A page that never loaded the init script, or a browser where the real
    // API is absent, reads the same way.
    it('explains a missing modelContext instead of dereferencing undefined', async () => {
      Reflect.deleteProperty(document, 'modelContext')

      await expect(context.callTool('add_to_cart')).rejects.toThrow(
        'document.modelContext is undefined',
      )
    })
  })

  describe('calls', () => {
    it('is empty before the agent does anything', async () => {
      await mountCart()

      expect(await context.calls()).toEqual([])
    })

    it('records each invocation in order, with the input parsed back', async () => {
      await mountCart()
      await context.callTool('add_to_cart', { qty: 2, sku: 'espresso' })
      await context.callTool('cart_total')

      expect(await context.calls()).toEqual([
        { input: { qty: 2, sku: 'espresso' }, name: 'add_to_cart', result: '{"sku":"espresso","total":2}' },
        { input: {}, name: 'cart_total', result: '{"total":2}' },
      ])
    })

    it('records a handled failure, because the agent was given an answer', async () => {
      await mountCart()
      await context.callTool('out_of_stock')

      expect(await context.calls()).toEqual([
        { input: {}, name: 'out_of_stock', result: 'Error: the espresso ran out' },
      ])
    })

    it('records nothing for a call the browser rejected', async () => {
      await document.modelContext!.registerTool({
        description: 'Registered straight past webmcpable, and throws',
        execute: () => {
          throw new Error('nope')
        },
        name: 'raw_thrower',
      })
      await expect(context.callTool('raw_thrower')).rejects.toThrow()

      expect(await context.calls()).toEqual([])
    })

    // The handle belongs to one document, so a page that never ran the init
    // script has no list rather than a misleading empty one.
    it('is empty when the init script never ran', async () => {
      Reflect.deleteProperty(window, '__webmcpableTesting')

      expect(await context.calls()).toEqual([])
    })
  })
})

describe('webmcpable/testing/browser', () => {
  it('installs the fake and parks the handle where the helper looks', async () => {
    // Reflect, not `delete`: the operator narrows the global to `never` for the
    // rest of the block, and the whole point is to read it again afterwards.
    Reflect.deleteProperty(window, '__webmcpableTesting')
    Reflect.deleteProperty(document, 'modelContext')
    vi.resetModules()

    await import('./browser')

    expect(document.modelContext).toBeDefined()
    expect(window.__webmcpableTesting?.calls).toEqual([])
  })
})
