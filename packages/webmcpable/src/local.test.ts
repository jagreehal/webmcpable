import { describe, expect, it, vi } from 'vitest'
import * as z from 'zod'
import { localTools } from './local'

const byName = (tools: ReturnType<typeof localTools>, name: string) =>
  tools.find((t) => t.name === name)!

describe('localTools()', () => {
  it('is the shape LanguageModel.create({ tools }) takes', () => {
    const [tool] = localTools({
      get_weather: {
        description: 'Get the weather in a location.',
        input: z.object({ location: z.string() }),
        execute: () => 'sunny',
      },
    })

    expect(tool).toMatchObject({
      description: 'Get the weather in a location.',
      name: 'get_weather',
      inputSchema: expect.objectContaining({ type: 'object' }),
    })
    expect(typeof tool!.execute).toBe('function')
  })

  it('returns a string, whatever the handler returns', async () => {
    const tools = localTools({
      json: { description: 'j', execute: () => ({ a: 1 }) },
      nothing: { description: 'n', execute: () => undefined },
      throws: {
        description: 't',
        execute: () => {
          throw new Error('out of stock')
        },
      },
    })

    await expect(byName(tools, 'json').execute({})).resolves.toBe('{"a":1}')
    await expect(byName(tools, 'nothing').execute({})).resolves.toBe('')
    await expect(byName(tools, 'throws').execute({})).resolves.toBe('Error: out of stock')
  })

  it('validates input before the handler runs', async () => {
    const execute = vi.fn(() => 'ran')
    const [tool] = localTools({
      book: { description: 'b', input: z.object({ seats: z.number() }), execute },
    })

    await expect(tool!.execute({ seats: 'two' })).resolves.toMatch(/^Invalid input —/)
    expect(execute).not.toHaveBeenCalled()
  })

  it('omits a tool `when` denies, and keeps one that gives a reason', async () => {
    const execute = vi.fn(() => 'ran')
    const tools = localTools({
      checkout: { description: 'c', execute, when: () => false },
      export_report: {
        description: 'e',
        execute,
        when: () => 'Exports are not included in this workspace plan.',
      },
    })

    expect(tools.map((t) => t.name)).toEqual(['export_report'])
    await expect(byName(tools, 'export_report').execute({})).resolves.toBe(
      'Exports are not included in this workspace plan.',
    )
    expect(execute).not.toHaveBeenCalled()
  })

  it('refuses a tool whose `when` became false after the session was created', async () => {
    // A session holds the array it was created with. The page state moves
    // underneath it; the call must not still run.
    let allowed = true
    const execute = vi.fn(() => 'ran')
    const [tool] = localTools({
      checkout: { description: 'Place the order', execute, when: () => allowed },
    })

    allowed = false

    await expect(tool!.execute({})).resolves.toBe('checkout is not available right now.')
    expect(execute).not.toHaveBeenCalled()
  })

  it('asks before a mutating tool runs, and not for a read-only one', async () => {
    const confirm = vi.fn(() => false)
    const execute = vi.fn(() => 'ran')
    const tools = localTools(
      {
        read: { annotations: { readOnlyHint: true }, description: 'r', execute },
        write: { description: 'w', execute },
      },
      { confirm },
    )

    await expect(byName(tools, 'read').execute({})).resolves.toBe('ran')
    expect(confirm).not.toHaveBeenCalled()

    await expect(byName(tools, 'write').execute({})).resolves.toBe('write was not confirmed.')
    expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ name: 'write' }))
  })
})
