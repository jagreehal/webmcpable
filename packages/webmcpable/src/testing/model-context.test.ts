import { beforeEach, describe, expect, it } from 'vitest'
import { readInputSchema } from '../schema'
import { tools } from '../tools'
import { installTestModelContext, toolSchemas } from './index'
import { modelContext } from '../model-context'

// This fake covers the Chrome 151 registration, inspection, and execution
// behavior that application tests rely on. spike/SPIKE-FINDINGS.md records each
// measured quirk.
describe('installTestModelContext', () => {
  let mc: ReturnType<typeof installTestModelContext>

  beforeEach(() => {
    mc = installTestModelContext()
  })

  const tool = (name: string, execute: (i: unknown) => unknown) => ({
    description: `test ${name}`,
    execute,
    inputSchema: { properties: {}, type: 'object' as const },
    name,
  })

  it('exposes itself on document.modelContext', () => {
    expect(document.modelContext).toBeDefined()
  })

  it('registers a tool and lists it', async () => {
    await modelContext().registerTool(tool('a', () => 'ok'))
    const tools = await modelContext().getTools()
    expect(tools.map((t) => t.name)).toEqual(['a'])
  })

  it('rejects a duplicate tool name, as the spec requires', async () => {
    await modelContext().registerTool(tool('a', () => 'ok'))
    await expect(modelContext().registerTool(tool('a', () => 'ok'))).rejects.toThrow()
  })

  it.each(['', 'has space', 'x'.repeat(129)])('rejects the invalid tool name %j', async (name) => {
    await expect(modelContext().registerTool(tool(name, () => 'ok'))).rejects.toMatchObject({
      name: 'InvalidStateError',
    })
  })

  it('rejects a non-function execute with a TypeError, like Chrome 152', async () => {
    // Measured against Chrome 152: `execute` is a required WebIDL member, so it
    // fails at the binding layer rather than as an InvalidStateError.
    await expect(
      modelContext().registerTool({ ...tool('a', () => 'ok'), execute: 'nope' as never }),
    ).rejects.toBeInstanceOf(TypeError)
  })

  it('rejects an empty description', async () => {
    await expect(
      modelContext().registerTool({ ...tool('a', () => 'ok'), description: '' }),
    ).rejects.toMatchObject({ name: 'InvalidStateError' })
  })

  it('rejects a schema that JSON cannot serialize', async () => {
    const inputSchema: Record<string, unknown> = {}
    inputSchema['self'] = inputSchema
    await expect(
      modelContext().registerTool({ ...tool('a', () => 'ok'), inputSchema }),
    ).rejects.toBeInstanceOf(TypeError)
  })

  it('rejects an untrustworthy exposed origin', async () => {
    await expect(
      modelContext().registerTool(tool('a', () => 'ok'), { exposedTo: ['http://example.com'] }),
    ).rejects.toMatchObject({ name: 'SecurityError' })
  })

  it('rejects an already-aborted registration with the abort reason', async () => {
    const controller = new AbortController()
    controller.abort(new DOMException('stopped', 'AbortError'))

    await expect(
      modelContext().registerTool(tool('a', () => 'ok'), { signal: controller.signal }),
    ).rejects.toMatchObject({ message: 'stopped', name: 'AbortError' })
    expect(await modelContext().getTools()).toEqual([])
  })

  it('unregisters when the AbortSignal fires', async () => {
    const c = new AbortController()
    await modelContext().registerTool(tool('a', () => 'ok'), { signal: c.signal })
    c.abort()
    expect((await modelContext().getTools()).length).toBe(0)
  })

  it('requires input arguments as a JSON string, like Chrome', async () => {
    await modelContext().registerTool(tool('a', () => 'ok'))
    const [t] = await modelContext().getTools()
    // @ts-expect-error deliberately passing the shape Chrome rejects
    await expect(modelContext().executeTool(t!, { q: 'x' })).rejects.toThrow(
      /Failed to parse input arguments/,
    )
    await expect(modelContext().executeTool(t!, '{}')).resolves.toBe('ok')
  })

  it('stringifies results and never unwraps an MCP envelope', async () => {
    await modelContext().registerTool(
      tool('a', () => ({ content: [{ text: 'hi', type: 'text' }] })),
    )
    const [t] = await modelContext().getTools()
    await expect(modelContext().executeTool(t!, '{}')).resolves.toBe(
      '{"content":[{"text":"hi","type":"text"}]}',
    )
  })

  it('turns undefined into the literal string "undefined", like Chrome', async () => {
    await modelContext().registerTool(tool('a', () => undefined))
    const [t] = await modelContext().getTools()
    await expect(modelContext().executeTool(t!, '{}')).resolves.toBe('undefined')
  })

  it('erases thrown error messages, like Chrome', async () => {
    await modelContext().registerTool(
      tool('a', () => {
        throw new Error('boom')
      }),
    )
    const [t] = await modelContext().getTools()
    await expect(modelContext().executeTool(t!, '{}')).rejects.toThrow(/invocation failed/)
  })

  it('substitutes "Operation succeeded" for an empty result, like Chrome', async () => {
    await modelContext().registerTool(tool('a', () => ''))
    const [t] = await modelContext().getTools()
    await expect(modelContext().executeTool(t!, '{}')).resolves.toBe('Operation succeeded')
  })

  it('preserves whitespace, zero and false, unlike the empty string', async () => {
    const cases: Array<[string, unknown, string]> = [
      ['ws', ' ', ' '],
      ['zero', 0, '0'],
      ['no', false, 'false'],
      ['nil', null, 'null'],
    ]
    for (const [name, value, expected] of cases) {
      await modelContext().registerTool(tool(name, () => value))
      const found = (await modelContext().getTools()).find((t) => t.name === name)
      await expect(modelContext().executeTool(found!, '{}')).resolves.toBe(expected)
    }
  })

  it('strips unknown annotations and normalises the known two, like Chrome', async () => {
    await modelContext().registerTool({
      ...tool('a', () => 'ok'),
      // deliberately invalid: the point is that Chrome drops it
      annotations: { destructiveHint: true, readOnlyHint: true } as WebMCP.ToolAnnotations,
    })
    const [t] = await modelContext().getTools()
    expect(t!.annotations).toEqual({ readOnlyHint: true, untrustedContentHint: false })
  })

  it('returns no annotations when none were sent', async () => {
    await modelContext().registerTool(tool('a', () => 'ok'))
    const [t] = await modelContext().getTools()
    expect(t!.annotations).toBeUndefined()
  })

  it('returns inputSchema as a JSON string, as Chrome does', async () => {
    await modelContext().registerTool(tool('a', () => 'ok'))
    const [t] = await modelContext().getTools()
    expect(typeof t!.inputSchema).toBe('string')
    expect(readInputSchema(t!.inputSchema)).toEqual({ properties: {}, type: 'object' })
  })

  it('defaults title to an empty string and exposes origin', async () => {
    await modelContext().registerTool(tool('a', () => 'ok'))
    const [t] = await modelContext().getTools()
    expect(t!.title).toBe('')
    expect(t!.origin).toBe(location.origin)
  })

  // The following are transcribed from web-platform-tests/wpt/webmcp/imperative.
  // WPT is the cross-browser ground truth; the fake has to agree with it or a
  // green test suite means nothing.

  it('returns tools in lexicographical order, not registration order', async () => {
    // wpt: getTools.https.html
    await modelContext().registerTool(tool('c', () => 'ok'))
    await modelContext().registerTool(tool('b', () => 'ok'))
    await modelContext().registerTool(tool('a', () => 'ok'))
    expect((await modelContext().getTools()).map((t) => t.name)).toEqual(['a', 'b', 'c'])
  })

  it('keeps lexicographical order after one tool is unregistered', async () => {
    // wpt: getTools.https.html
    const controller = new AbortController()
    await modelContext().registerTool(tool('c', () => 'ok'))
    await modelContext().registerTool(tool('b', () => 'ok'), { signal: controller.signal })
    await modelContext().registerTool(tool('a', () => 'ok'))
    controller.abort()
    expect((await modelContext().getTools()).map((t) => t.name)).toEqual(['a', 'c'])
  })

  it('accepts a JSON array as input, because arrays are objects', async () => {
    // wpt: object-arguments.https.html
    let received: unknown
    await modelContext().registerTool(
      tool('a', (input) => {
        received = input
        return 'ok'
      }),
    )
    const [t] = await modelContext().getTools()
    await expect(modelContext().executeTool(t!, '[1, 2, 3]')).resolves.toBe('ok')
    expect(received).toEqual([1, 2, 3])
  })

  it.each([
    ['string', '"hello"'],
    ['number', '123'],
    ['boolean', 'true'],
    ['null', 'null'],
  ])('rejects a JSON %s, which is not an object', async (_label, args) => {
    // wpt: object-arguments.https.html
    await modelContext().registerTool(tool('a', () => 'ok'))
    const [t] = await modelContext().getTools()
    await expect(modelContext().executeTool(t!, args)).rejects.toThrow()
  })

  it('records calls so tests can assert on what the agent did', async () => {
    await modelContext().registerTool(tool('a', () => 'ok'))
    const [t] = await modelContext().getTools()
    await modelContext().executeTool(t!, '{"q":"x"}')
    expect(mc.calls).toEqual([{ input: { q: 'x' }, name: 'a', result: 'ok' }])
  })
})

// `webmcp-evals local -t schema.json` reads the tool list off disk. Writing
// that file by hand duplicates the registry and drifts from it.
describe('toolSchemas', () => {
  let mc: ReturnType<typeof installTestModelContext>

  beforeEach(() => {
    mc = installTestModelContext()
    return () => mc.uninstall()
  })

  it('exports the registered tools in the shape webmcp-evals reads', async () => {
    await tools({
      add_topping: {
        description: 'Add a topping to the pizza',
        execute: () => 'added',
        input: { properties: { topping: { type: 'string' } }, required: ['topping'], type: 'object' },
      },
      reset: { description: 'Start the pizza again', execute: () => 'reset' },
    }).mount()

    expect(await toolSchemas()).toEqual({
      tools: [
        {
          description: 'Add a topping to the pizza',
          inputSchema: { properties: { topping: { type: 'string' } }, required: ['topping'], type: 'object' },
          name: 'add_topping',
        },
        {
          description: 'Start the pizza again',
          inputSchema: { properties: {}, type: 'object' },
          name: 'reset',
        },
      ],
    })
  })

  it('survives JSON.stringify, which a raw RegisteredTool does not', async () => {
    await tools({ a: { description: 'a tool', execute: () => 'a' } }).mount()

    const [registered] = await modelContext().getTools()
    expect(() => JSON.stringify(registered)).toThrow()
    expect(JSON.stringify(await toolSchemas())).toContain('"name":"a"')
  })
})
