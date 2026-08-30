import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as z from 'zod'
import { readInputSchema } from './schema'
import { installTestModelContext } from './testing/index'
import { modelContext } from './model-context'
import { tools } from './tools'

const names = async () => (await modelContext().getTools()).map((t) => t.name).sort()

describe('tools()', () => {
  beforeEach(() => installTestModelContext())

  it('registers every tool on mount', async () => {
    const r = tools({
      a: { description: 'a', execute: () => 'a' },
      b: { description: 'b', execute: () => 'b' },
    })
    await r.mount()
    expect(await names()).toEqual(['a', 'b'])
  })

  it('does nothing when WebMCP is unavailable', async () => {
    delete (document as { modelContext?: unknown }).modelContext
    const r = tools({ a: { description: 'a', execute: () => 'a' } })

    await expect(r.mount()).resolves.toBeUndefined()
    await expect(r.revalidate()).resolves.toBeUndefined()
    r.unmount()
  })

  it('passes exposed origins to the browser', async () => {
    const registerTool = vi.spyOn(modelContext(), 'registerTool')
    const exposedTo = ['https://agent.example']
    const r = tools({
      a: { description: 'a', exposedTo, execute: () => 'a' },
    })

    await r.mount()

    expect(registerTool).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'a' }),
      expect.objectContaining({ exposedTo }),
    )
  })

  it('can retry a registration that failed', async () => {
    const registerTool = vi.spyOn(modelContext(), 'registerTool')
    registerTool.mockRejectedValueOnce(new DOMException('try again', 'InvalidStateError'))
    const r = tools({ a: { description: 'a', execute: () => 'a' } })

    await expect(r.mount()).rejects.toThrow('try again')
    await expect(r.mount()).resolves.toBeUndefined()
    expect(await names()).toEqual(['a'])
  })

  it('skips tools whose `when` is false', async () => {
    const r = tools({
      always: { description: 'x', execute: () => 'x' },
      never: { description: 'y', execute: () => 'y', when: () => false },
    })
    await r.mount()
    expect(await names()).toEqual(['always'])
  })

  it('keeps a tool listed when `when` returns a reason instead of false', async () => {
    const r = tools({
      export_report: {
        description: 'Export the report',
        execute: () => 'x',
        when: () => 'Exports are not included in this workspace plan.',
      },
    })
    await r.mount()
    expect(await names()).toEqual(['export_report'])

    // Still there after the list is re-evaluated: only `false` unregisters.
    await r.revalidate()
    expect(await names()).toEqual(['export_report'])
  })

  it('registers a tool that becomes eligible on revalidate', async () => {
    let ready = false
    const r = tools({ go: { description: 'go', execute: () => 'go', when: () => ready } })
    await r.mount()
    expect(await names()).toEqual([])

    ready = true
    await r.revalidate()
    expect(await names()).toEqual(['go'])
  })

  it('unregisters a tool that becomes ineligible on revalidate', async () => {
    let ready = true
    const r = tools({ go: { description: 'go', execute: () => 'go', when: () => ready } })
    await r.mount()
    ready = false
    await r.revalidate()
    expect(await names()).toEqual([])
  })

  it('does not re-register an unchanged tool (that would throw a duplicate)', async () => {
    const r = tools({ a: { description: 'a', execute: () => 'a' } })
    await r.mount()
    await r.revalidate()
    await r.revalidate()
    expect(await names()).toEqual(['a'])
  })

  it('unregisters everything on unmount', async () => {
    const r = tools({ a: { description: 'a', execute: () => 'a' } })
    await r.mount()
    r.unmount()
    expect(await names()).toEqual([])
  })

  it('derives an input schema from a Standard Schema', async () => {
    const r = tools({
      search: {
        description: 'search',
        execute: ({ q }) => q,
        input: z.object({ q: z.string().describe('the query') }),
      },
    })
    await r.mount()
    const [tool] = await modelContext().getTools()
    // Chrome hands inputSchema back as a JSON string, not an object.
    expect(readInputSchema(tool!.inputSchema)).toMatchObject({
      properties: { q: { description: 'the query', type: 'string' } },
      type: 'object',
    })
  })

  it('names the tool when the browser refuses the registration', async () => {
    // Chrome says only "Duplicate tool name" — which one is left to the reader,
    // and a `<form toolname>` can be the other claimant. Measured in
    // e2e/declarative.conformance.ts.
    await modelContext().registerTool({
      description: 'Already claimed by something else',
      execute: () => 'other',
      name: 'book_table',
    })

    await expect(
      tools({ book_table: { description: 'Ours', execute: () => 'ours' } }).mount(),
    ).rejects.toThrow(/could not register "book_table"/)
  })

  it('passes validated, typed input to the execute', async () => {
    const execute = vi.fn(({ q }: { q: string }) => q.toUpperCase())
    const r = tools({
      search: { description: 'search', execute, input: z.object({ q: z.string() }) },
    })
    await r.mount()
    const [tool] = await modelContext().getTools()
    await expect(modelContext().executeTool(tool!, '{"q":"hi"}')).resolves.toBe('HI')
    expect(execute).toHaveBeenCalledWith({ q: 'hi' }, expect.anything())
  })

  it('rejects invalid input before the execute runs, and says why', async () => {
    const execute = vi.fn(() => 'never')
    const r = tools({
      search: { description: 'search', execute, input: z.object({ q: z.string() }) },
    })
    await r.mount()
    const [tool] = await modelContext().getTools()
    const result = await modelContext().executeTool(tool!, '{"q":42}')
    expect(result).toMatch(/q/)
    expect(execute).not.toHaveBeenCalled()
  })

  it('never lets the literal "undefined" reach the agent', async () => {
    const r = tools({ a: { description: 'a', execute: () => undefined } })
    await r.mount()
    const [tool] = await modelContext().getTools()
    // We map undefined -> '', and Chrome turns '' into a canned success
    // message. Hand-rolled code would send the literal text "undefined".
    await expect(modelContext().executeTool(tool!, '{}')).resolves.toBe('Operation succeeded')
  })

  it('forwards title to the browser by default', async () => {
    const r = tools({
      checkout: {
        description: 'Place the order',
        execute: () => 'ok',
        title: 'Add 2 coffees',
      },
    })
    await r.mount()
    expect((await modelContext().getTools())[0]!.title).toBe('Add 2 coffees')
  })

  it('does not send title when titles is off', async () => {
    const r = tools({
      checkout: {
        description: 'Place the order',
        execute: () => 'ok',
        title: 'Add 2 coffees',
      },
    }, { titles: 'off' })
    await r.mount()
    expect((await modelContext().getTools())[0]!.title).toBe('')
  })

  it('returns thrown errors as text rather than throwing (Chrome erases them)', async () => {
    const r = tools({
      a: {
        description: 'a',
        execute: () => {
          throw new Error('boom')
        },
      },
    })
    await r.mount()
    const [tool] = await modelContext().getTools()
    await expect(modelContext().executeTool(tool!, '{}')).resolves.toMatch(/boom/)
  })
})
