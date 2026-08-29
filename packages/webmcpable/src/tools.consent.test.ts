import * as z from 'zod'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { modelContext } from './model-context'
import { installTestModelContext } from './testing/index'
import { tools } from './tools'

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
    const handler = vi.fn(() => 'ran')
    const registry = tools({
      checkout: { description: 'Place the order', handler, when: () => allowed },
    })
    await registry.mount()
    const [tool] = await modelContext().getTools()

    // The agent holds a tool it was legitimately offered; the page state moves
    // underneath it before the call lands.
    allowed = false

    await expect(modelContext().executeTool(tool!, '{}')).resolves.toBe(
      'checkout is not available right now.',
    )
    expect(handler).not.toHaveBeenCalled()
  })

  it('refuses with the reason `when` returned, and stays visible', async () => {
    // webmachinelearning/webmcp#262: unregistering throws away what the page
    // knows. A reason string keeps the tool listed and explains the refusal.
    const handler = vi.fn(() => 'ran')
    const registry = tools({
      export_report: {
        description: 'Export the report',
        handler,
        when: () => 'Exports are not included in this workspace plan.',
      },
    })
    await registry.mount()
    const [tool] = await modelContext().getTools()

    await expect(modelContext().executeTool(tool!, '{}')).resolves.toBe(
      'Exports are not included in this workspace plan.',
    )
    expect(handler).not.toHaveBeenCalled()

    await registry.revalidate()
    expect(await modelContext().getTools()).toHaveLength(1)
  })

  it('falls back to the generic refusal when the reason is empty', async () => {
    const registry = tools({
      checkout: { description: 'Place the order', handler: () => 'ran', when: () => '' },
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
      checkout: { description: 'Place the order', handler: () => 'ran', when: () => allowed },
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
      checkout: { description: 'Place the order', handler: () => 'ran', when: () => true },
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
        handler: () => 'ran',
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
    // and the gate fails closed: the handler never runs.
    await expect(modelContext().executeTool(tool!, '{}')).resolves.toBe(
      'Error: predicate exploded',
    )
  })

  it('re-registers a tool whose description changed in place, so the agent stops seeing the old one', async () => {
    const defs = { search: { description: 'Search all products', handler: () => 'ok' } }
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
        handler: () => 'ok',
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
    const registry = tools({ search: { description: 'Search products', handler: () => 'ok' } })
    await registry.mount()
    // A second sync must not abort and re-register: the platform rejects a
    // duplicate name, so churn here would surface as a registration failure.
    await registry.revalidate()

    expect(await descriptions()).toEqual(['Search products'])
  })

  it('rejects a raw JSON Schema call that omits a required property, and names it', async () => {
    const handler = vi.fn(() => 'ran')
    const registry = tools({
      ship: {
        description: 'Ship the order',
        handler,
        input: { properties: { address: { type: 'string' } }, required: ['address'], type: 'object' },
      },
    })
    await registry.mount()
    const [tool] = await modelContext().getTools()

    await expect(modelContext().executeTool(tool!, '{}')).resolves.toBe(
      'Invalid input — missing required: address',
    )
    expect(handler).not.toHaveBeenCalled()
  })

  it('passes a raw JSON Schema call through when the required properties are present', async () => {
    const registry = tools({
      ship: {
        description: 'Ship the order',
        handler: (input) => `to ${(input as { address: string }).address}`,
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
