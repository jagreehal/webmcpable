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
      a: { description: 'a', handler: () => 'a' },
      b: { description: 'b', handler: () => 'b' },
    })
    await r.mount()
    expect(await names()).toEqual(['a', 'b'])
  })

  it('does nothing when WebMCP is unavailable', async () => {
    delete (document as { modelContext?: unknown }).modelContext
    const r = tools({ a: { description: 'a', handler: () => 'a' } })

    await expect(r.mount()).resolves.toBeUndefined()
    await expect(r.revalidate()).resolves.toBeUndefined()
    r.unmount()
  })

  it('passes exposed origins to the browser', async () => {
    const registerTool = vi.spyOn(modelContext(), 'registerTool')
    const exposedTo = ['https://agent.example']
    const r = tools({
      a: { description: 'a', exposedTo, handler: () => 'a' },
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
    const r = tools({ a: { description: 'a', handler: () => 'a' } })

    await expect(r.mount()).rejects.toThrow('try again')
    await expect(r.mount()).resolves.toBeUndefined()
    expect(await names()).toEqual(['a'])
  })

  it('skips tools whose `when` is false', async () => {
    const r = tools({
      always: { description: 'x', handler: () => 'x' },
      never: { description: 'y', handler: () => 'y', when: () => false },
    })
    await r.mount()
    expect(await names()).toEqual(['always'])
  })

  it('keeps a tool listed when `when` returns a reason instead of false', async () => {
    const r = tools({
      export_report: {
        description: 'Export the report',
        handler: () => 'x',
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
    const r = tools({ go: { description: 'go', handler: () => 'go', when: () => ready } })
    await r.mount()
    expect(await names()).toEqual([])

    ready = true
    await r.revalidate()
    expect(await names()).toEqual(['go'])
  })

  it('unregisters a tool that becomes ineligible on revalidate', async () => {
    let ready = true
    const r = tools({ go: { description: 'go', handler: () => 'go', when: () => ready } })
    await r.mount()
    ready = false
    await r.revalidate()
    expect(await names()).toEqual([])
  })

  it('does not re-register an unchanged tool (that would throw a duplicate)', async () => {
    const r = tools({ a: { description: 'a', handler: () => 'a' } })
    await r.mount()
    await r.revalidate()
    await r.revalidate()
    expect(await names()).toEqual(['a'])
  })

  it('unregisters everything on unmount', async () => {
    const r = tools({ a: { description: 'a', handler: () => 'a' } })
    await r.mount()
    r.unmount()
    expect(await names()).toEqual([])
  })

  it('derives an input schema from a Standard Schema', async () => {
    const r = tools({
      search: {
        description: 'search',
        handler: ({ q }) => q,
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

  it('passes validated, typed input to the handler', async () => {
    const handler = vi.fn(({ q }: { q: string }) => q.toUpperCase())
    const r = tools({
      search: { description: 'search', handler, input: z.object({ q: z.string() }) },
    })
    await r.mount()
    const [tool] = await modelContext().getTools()
    await expect(modelContext().executeTool(tool!, '{"q":"hi"}')).resolves.toBe('HI')
    expect(handler).toHaveBeenCalledWith({ q: 'hi' }, expect.anything())
  })

  it('rejects invalid input before the handler runs, and says why', async () => {
    const handler = vi.fn(() => 'never')
    const r = tools({
      search: { description: 'search', handler, input: z.object({ q: z.string() }) },
    })
    await r.mount()
    const [tool] = await modelContext().getTools()
    const result = await modelContext().executeTool(tool!, '{"q":42}')
    expect(result).toMatch(/q/)
    expect(handler).not.toHaveBeenCalled()
  })

  it('never lets the literal "undefined" reach the agent', async () => {
    const r = tools({ a: { description: 'a', handler: () => undefined } })
    await r.mount()
    const [tool] = await modelContext().getTools()
    // We map undefined -> '', and Chrome turns '' into a canned success
    // message. Hand-rolled code would send the literal text "undefined".
    await expect(modelContext().executeTool(tool!, '{}')).resolves.toBe('Operation succeeded')
  })

  it('returns thrown errors as text rather than throwing (Chrome erases them)', async () => {
    const r = tools({
      a: {
        description: 'a',
        handler: () => {
          throw new Error('boom')
        },
      },
    })
    await r.mount()
    const [tool] = await modelContext().getTools()
    await expect(modelContext().executeTool(tool!, '{}')).resolves.toMatch(/boom/)
  })
})
