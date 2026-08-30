import * as z from 'zod'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { modelContext } from './model-context'
import { installTestModelContext } from './testing/index'
import { formatConfirmPrompt, tools, type RegistryOptions } from './tools'

/**
 * The consent moment is the whole human-agent interface: a user approves a tool
 * by its descriptor, then the browser runs whatever code that name now points
 * at. These pin the two halves this library can actually keep honest — the
 * descriptor stays current, and an ineligible tool refuses.
 */
describe('what the agent is allowed to run', () => {
  beforeEach(() => {
    installTestModelContext()
  })

  const descriptions = async () =>
    (await modelContext().getTools()).map((t) => t.description)

  it('refuses to run a tool whose `when` became false after it was registered', async () => {
    let allowed = true
    const execute = vi.fn(() => 'ran')
    const registry = tools({
      checkout: { description: 'Place the order', execute, when: () => allowed },
    })
    await registry.mount()
    const [tool] = await modelContext().getTools()

    // The agent holds a tool it was legitimately offered; the page state moves
    // underneath it before the call lands.
    allowed = false

    await expect(modelContext().executeTool(tool!, '{}')).resolves.toBe(
      'checkout is not available right now.',
    )
    expect(execute).not.toHaveBeenCalled()
  })

  it('refuses with the reason `when` returned, and stays visible', async () => {
    // webmachinelearning/webmcp#262: unregistering throws away what the page
    // knows. A reason string keeps the tool listed and explains the refusal.
    const execute = vi.fn(() => 'ran')
    const registry = tools({
      export_report: {
        description: 'Export the report',
        execute,
        when: () => 'Exports are not included in this workspace plan.',
      },
    })
    await registry.mount()
    const [tool] = await modelContext().getTools()

    await expect(modelContext().executeTool(tool!, '{}')).resolves.toBe(
      'Exports are not included in this workspace plan.',
    )
    expect(execute).not.toHaveBeenCalled()

    await registry.revalidate()
    expect(await modelContext().getTools()).toHaveLength(1)
  })

  it('falls back to the generic refusal when the reason is empty', async () => {
    const registry = tools({
      checkout: { description: 'Place the order', execute: () => 'ran', when: () => '' },
    })
    await registry.mount()
    const [tool] = await modelContext().getTools()

    await expect(modelContext().executeTool(tool!, '{}')).resolves.toBe(
      'checkout is not available right now.',
    )
  })

  it('leaves the stale tool registered until the next revalidate', async () => {
    // Measured in Chrome 152: unregistering inside the refusal aborts the
    // in-flight call, and the agent gets a transient UnknownError instead of
    // the refusal text. Refusing is the guard; the list catches up after.
    let allowed = true
    const registry = tools({
      checkout: { description: 'Place the order', execute: () => 'ran', when: () => allowed },
    })
    await registry.mount()
    const [tool] = await modelContext().getTools()
    allowed = false
    await modelContext().executeTool(tool!, '{}')

    expect(await modelContext().getTools()).toHaveLength(1)

    await registry.revalidate()
    expect(await modelContext().getTools()).toEqual([])
  })

  it('still runs a tool whose `when` holds at execution time', async () => {
    const registry = tools({
      checkout: { description: 'Place the order', execute: () => 'ran', when: () => true },
    })
    await registry.mount()
    const [tool] = await modelContext().getTools()

    await expect(modelContext().executeTool(tool!, '{}')).resolves.toBe('ran')
  })

  it('reports a `when` that throws at execution time as text rather than throwing', async () => {
    // Only arms after mount: a predicate that throws during sync propagates out
    // of mount(), which is pre-existing behaviour and not what this pins.
    let armed = false
    const registry = tools({
      checkout: {
        description: 'Place the order',
        execute: () => 'ran',
        when: () => {
          if (armed) {throw new Error('predicate exploded')}
          return true
        },
      },
    })
    await registry.mount()
    const [tool] = await modelContext().getTools()
    armed = true

    // Chrome discards thrown messages, so the refusal has to come back as text,
    // and the gate fails closed: the execute never runs.
    await expect(modelContext().executeTool(tool!, '{}')).resolves.toBe(
      'Error: predicate exploded',
    )
  })

  it('re-registers a tool whose description changed in place, so the agent stops seeing the old one', async () => {
    const defs = { search: { description: 'Search all products', execute: () => 'ok' } }
    const registry = tools(defs)
    await registry.mount()
    expect(await descriptions()).toEqual(['Search all products'])

    defs.search.description = 'Search products currently in stock'
    await registry.revalidate()

    expect(await descriptions()).toEqual(['Search products currently in stock'])
  })

  it('re-registers when only the input schema changed', async () => {
    const defs = {
      search: {
        description: 'Search products',
        execute: () => 'ok',
        input: z.object({ q: z.string() }) as z.ZodType,
      },
    }
    const registry = tools(defs)
    await registry.mount()
    const before = (await modelContext().getTools())[0]!.inputSchema

    defs.search.input = z.object({ q: z.string(), inStock: z.boolean() })
    await registry.revalidate()

    expect((await modelContext().getTools())[0]!.inputSchema).not.toEqual(before)
  })

  it('leaves a tool alone when its descriptor is unchanged', async () => {
    const registry = tools({ search: { description: 'Search products', execute: () => 'ok' } })
    await registry.mount()
    // A second sync must not abort and re-register: the platform rejects a
    // duplicate name, so churn here would surface as a registration failure.
    await registry.revalidate()

    expect(await descriptions()).toEqual(['Search products'])
  })

  it('rejects a raw JSON Schema call that omits a required property, and names it', async () => {
    const execute = vi.fn(() => 'ran')
    const registry = tools({
      ship: {
        description: 'Ship the order',
        execute,
        input: { properties: { address: { type: 'string' } }, required: ['address'], type: 'object' },
      },
    })
    await registry.mount()
    const [tool] = await modelContext().getTools()

    await expect(modelContext().executeTool(tool!, '{}')).resolves.toBe(
      'Invalid input — missing required: address',
    )
    expect(execute).not.toHaveBeenCalled()
  })

  it('passes a raw JSON Schema call through when the required properties are present', async () => {
    const registry = tools({
      ship: {
        description: 'Ship the order',
        execute: (input) => `to ${(input as { address: string }).address}`,
        input: { properties: { address: { type: 'string' } }, required: ['address'], type: 'object' },
      },
    })
    await registry.mount()
    const [tool] = await modelContext().getTools()

    await expect(modelContext().executeTool(tool!, '{"address":"12 High St"}')).resolves.toBe(
      'to 12 High St',
    )
  })
})

describe('the page-side confirm, bound to the call that runs', () => {
  beforeEach(() => {
    installTestModelContext()
  })

  it('refuses a mutating tool when confirm returns false, and never runs the execute', async () => {
    const execute = vi.fn(() => 'ran')
    const registry = tools({
      checkout: { description: 'Place the order', execute },
    }, { confirm: () => false })
    await registry.mount()
    const [tool] = await modelContext().getTools()

    await expect(modelContext().executeTool(tool!, '{}')).resolves.toBe(
      'checkout was not confirmed.',
    )
    expect(execute).not.toHaveBeenCalled()
  })

  it('runs the execute when confirm returns true', async () => {
    const registry = tools({
      checkout: { description: 'Place the order', execute: () => 'ran' },
    }, { confirm: () => true })
    await registry.mount()
    const [tool] = await modelContext().getTools()

    await expect(modelContext().executeTool(tool!, '{}')).resolves.toBe('ran')
  })

  it('passes the resolved name and arguments, not the title, as the headline', async () => {
    const seen: Array<{ input: unknown; name: string; title?: string }> = []
    const registry = tools({
      update_shipping_address: {
        description: 'Change where this order ships',
        execute: () => 'ok',
        input: z.object({ address: z.string() }),
        title: 'Add 2 coffees',
      },
    }, {
      confirm: (call) => {
        seen.push({
          input: call.input,
          name: call.name,
          ...(call.title !== undefined && { title: call.title }),
        })
        return true
      },
    })
    await registry.mount()
    const [tool] = await modelContext().getTools()
    await modelContext().executeTool(tool!, '{"address":"PO Box 1"}')

    expect(seen).toEqual([
      { input: { address: 'PO Box 1' }, name: 'update_shipping_address', title: 'Add 2 coffees' },
    ])
  })

  it('skips confirm on a read-only tool', async () => {
    const registry = tools({
      search: {
        annotations: { readOnlyHint: true },
        description: 'Search the product catalogue',
        execute: () => 'ok',
      },
    }, { confirm: () => { throw new Error('should not ask') } })
    await registry.mount()
    const [tool] = await modelContext().getTools()

    await expect(modelContext().executeTool(tool!, '{}')).resolves.toBe('ok')
  })

  it('does not prompt when `when` already refuses the call', async () => {
    let asked = false
    const registry = tools({
      checkout: {
        description: 'Place the order',
        execute: () => 'ran',
        when: () => 'Cart is empty.',
      },
    }, { confirm: () => { asked = true; return true } })
    await registry.mount()
    const [tool] = await modelContext().getTools()
    await modelContext().executeTool(tool!, '{}')

    expect(asked).toBe(false)
  })

  it('flags a descriptor that moved since the tool was first registered', async () => {
    const seen: Array<boolean> = []
    const defs = { checkout: { description: 'Place the order', execute: () => 'ran' } }
    const registry = tools(defs, {
      confirm: (call) => {
        seen.push(call.descriptorChanged)
        return true
      },
    })
    await registry.mount()
    const [tool] = await modelContext().getTools()
    await modelContext().executeTool(tool!, '{}')

    defs.checkout.description = 'Ship the order'
    await modelContext().executeTool(tool!, '{}')

    expect(seen).toEqual([false, true])
  })

  it('formats the prompt as the resolved call, with the label demoted', () => {
    expect(
      formatConfirmPrompt({
        description: 'Change where this order ships',
        descriptorChanged: false,
        input: { address: 'PO Box 1' },
        name: 'update_shipping_address',
        title: 'Add 2 coffees',
      }),
    ).toBe('update_shipping_address {"address":"PO Box 1"}\nAdd 2 coffees')
  })

  it('does not ask when confirm is false — `confirm: isProduction` must stay silent off it', async () => {
    const spy = vi.spyOn(window, 'confirm').mockReturnValue(false)
    const registry = tools({
      checkout: { description: 'Place the order', execute: () => 'ordered', when: () => true },
    }, { confirm: false })
    await registry.mount()

    const [tool] = await modelContext().getTools()
    expect(await modelContext().executeTool(tool!, '{}')).toBe('ordered')
    expect(spy).not.toHaveBeenCalled()
  })

  it('confirms a call whose validated input does not survive JSON', async () => {
    const spy = vi.spyOn(window, 'confirm').mockReturnValue(true)
    const registry = tools({
      pay: {
        description: 'Pay the invoice',
        execute: ({ amount }) => `paid ${amount}`,
        input: {
          // A schema that validates to a BigInt: JSON Schema in, something JSON
          // cannot serialise out.
          '~standard': {
            validate: (value: unknown) => ({
              value: { amount: BigInt((value as { amount: string }).amount) },
            }),
            vendor: 'test',
            version: 1,
          },
          toJSONSchema: () => ({ properties: { amount: { type: 'string' } }, type: 'object' }),
        } as never,
        when: () => true,
      },
    }, { confirm: true })
    await registry.mount()

    const [tool] = await modelContext().getTools()
    expect(await modelContext().executeTool(tool!, '{"amount":"42"}')).toBe('paid 42')
    expect(spy).toHaveBeenCalledOnce()
  })

  it('shows arguments JSON cannot hold, rather than an empty object', () => {
    const cyclic: Record<string, unknown> = { name: 'Ada' }
    cyclic['self'] = cyclic

    expect(formatConfirmPrompt({
      description: 'Pay the invoice',
      descriptorChanged: false,
      input: { amount: 42n, seen: new Set([1, 2]), tags: new Map([['a', 1]]) },
      name: 'pay',
    })).toContain('"tags":{"a":1}')

    expect(formatConfirmPrompt({
      description: 'Save the profile',
      descriptorChanged: false,
      input: cyclic,
      name: 'save',
    })).toContain('Ada')
  })

  it('re-registers when titles is switched off after mount', async () => {
    const options: RegistryOptions = {}
    const registry = tools(
      { checkout: { description: 'Place the order', execute: () => 'ordered', title: 'Friendly checkout', when: () => true } },
      options,
    )
    await registry.mount()
    expect((await modelContext().getTools())[0]!.title).toBe('Friendly checkout')

    // The option is what decides the browser-facing descriptor, so changing it
    // has to move the descriptor.
    options.titles = 'off'
    await registry.revalidate()
    expect((await modelContext().getTools())[0]!.title).toBe('')
  })

  it('uses window.confirm when confirm is true', async () => {
    const spy = vi.spyOn(window, 'confirm').mockReturnValue(false)
    const execute = vi.fn(() => 'ran')
    const registry = tools({
      checkout: { description: 'Place the order', execute },
    }, { confirm: true })
    await registry.mount()
    const [tool] = await modelContext().getTools()

    await expect(modelContext().executeTool(tool!, '{}')).resolves.toBe(
      'checkout was not confirmed.',
    )
    expect(spy).toHaveBeenCalledWith(expect.stringContaining('checkout'))
    expect(execute).not.toHaveBeenCalled()
    spy.mockRestore()
  })
})
