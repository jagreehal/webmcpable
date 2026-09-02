import { expect, test, type CDPSession, type Page } from '@playwright/test'
import { story } from 'executable-stories-playwright'

/**
 * The path an agent actually takes.
 *
 * Every other lane in this package calls `document.modelContext.executeTool`
 * from inside the page. No agent does that. A real client drives Chrome's CDP
 * `WebMCP` domain from outside the browser — the surface
 * [agent-browser](https://github.com/vercel-labs/agent-browser) exposes as
 * `agent-browser webmcp list|invoke|result|cancel` — and that crossing has its
 * own rules for arguments, results, errors and cancellation.
 *
 * They are not the same rules. The in-page transcription said `execute`
 * receives `(input, options)`; the browser passes one argument, and this lane
 * is what found it.
 */

const HARNESS = '/e2e/fixtures/harness.html'
const FRAMES = '/e2e/fixtures/frames.html'

interface ToolRecord {
  description: string
  frameId: string
  inputSchema: Record<string, unknown>
  name: string
}

interface Responded {
  errorText?: string
  exception?: unknown
  invocationId: string
  output?: unknown
  status: 'Canceled' | 'Completed' | 'Error'
}

/**
 * A minimal WebMCP client: enable the domain, collect the tool list the page
 * advertises, and invoke one the way an out-of-process agent does.
 */
async function client(page: Page) {
  const cdp: CDPSession = await page.context().newCDPSession(page)
  const tools: Array<ToolRecord> = []
  const responses = new Map<string, Responded>()

  cdp.on('WebMCP.toolsAdded', (params) => tools.push(...((params as { tools: Array<ToolRecord> }).tools)))
  cdp.on('WebMCP.toolResponded', (params) => {
    const responded = params as Responded
    responses.set(responded.invocationId, responded)
  })
  await cdp.send('WebMCP.enable')
  await expect.poll(() => tools.length).toBeGreaterThan(0)

  const settle = async (invocationId: string) => {
    await expect.poll(() => responses.has(invocationId), { timeout: 5000 }).toBe(true)
    return responses.get(invocationId)!
  }

  return {
    cdp,
    /** Start an invocation without waiting for it — the `--detach` shape. */
    async start(name: string, input: Record<string, unknown> = {}) {
      const tool = tools.find((t) => t.name === name)
      if (!tool) {throw new Error(`no tool named ${name}: have ${tools.map((t) => t.name).join(', ')}`)}
      const { invocationId } = (await cdp.send('WebMCP.invokeTool', {
        frameId: tool.frameId,
        input,
        toolName: tool.name,
      } as never)) as unknown as { invocationId: string }
      return invocationId
    },
    async invoke(name: string, input: Record<string, unknown> = {}) {
      return settle(await this.start(name, input))
    },
    responded: (invocationId: string) => responses.get(invocationId),
    settle,
    tools,
  }
}

test.beforeEach(async ({ page }) => {
  await page.goto(HARNESS)
  await expect(page).toHaveTitle('ready')
})

test('the browser calls execute with one argument, and webmcpable supplies the second', async ({
  page,
}, testInfo) => {
  story.init({ page }, testInfo)

  story.given('a tool registered through webmcpable that records what it was called with')
  await page.evaluate(async () => {
    window.__seen = {}
    await window.webmcpable
      .tools({
        probe: {
          description: 'Records its arguments',
          execute: (_input: unknown, options: { signal: AbortSignal }) => {
            // Duck-typed rather than `instanceof`: this runs in the page, where
            // the assertion is only that something usable arrived.
            window.__seen = {
              signalIsAbortSignal: typeof options?.signal?.addEventListener === 'function',
            }
            return 'ok'
          },
        },
      })
      .mount()
  })

  story.when('an out-of-process client invokes it over CDP')
  const agent = await client(page)
  const result = await agent.invoke('probe')

  story.then('the call succeeds')
  expect(result.status).toBe('Completed')

  story.then('the handler received an options object carrying an AbortSignal')
  expect(await page.evaluate(() => window.__seen.signalIsAbortSignal)).toBe(true)
})

test('Chrome itself passes a registered execute exactly one argument', async ({ page }, testInfo) => {
  story.init({ page }, testInfo)

  story.given('a tool registered with the raw browser API, counting its arguments')
  await page.evaluate(() => {
    window.__argc = -1
    document.modelContext.registerTool({
      description: 'Counts its arguments',
      execute: (...args: Array<unknown>) => {
        window.__argc = args.length
        return 'counted'
      },
      inputSchema: { properties: {}, type: 'object' },
      name: 'raw_argc',
    } as never)
  })

  story.when('a client invokes it')
  const agent = await client(page)
  await agent.invoke('raw_argc')

  story.then('the handler saw one argument, so a documented (input, options) signature would break')
  expect(await page.evaluate(() => window.__argc)).toBe(1)
})

test('a JSON result reaches the client structured, not as a string', async ({ page }, testInfo) => {
  story.init({ page }, testInfo)

  story.given('tools returning an object, a string, and nothing')
  await page.evaluate(async () => {
    await window.webmcpable
      .tools({
        object: { description: 'Returns an object', execute: () => ({ count: 3, items: ['a'] }) },
        text: { description: 'Returns a string', execute: () => 'Added' },
        voider: { description: 'Returns undefined', execute: () => undefined },
      })
      .mount()
  })
  const agent = await client(page)

  story.when('a client invokes each one')
  const object = await agent.invoke('object')
  const text = await agent.invoke('text')
  const voider = await agent.invoke('voider')

  story.then('the object arrives as an object — Chrome parses the JSON webmcpable serialised')
  expect(object.output).toEqual({ count: 3, items: ['a'] })

  story.then('a plain string arrives as a string')
  expect(text.output).toBe('Added')

  story.then('an empty result becomes Chrome’s canned success text')
  expect(voider.output).toBe('Operation succeeded')
})

test('a thrown error reaches the client as a completed call carrying the message', async ({
  page,
}, testInfo) => {
  story.init({ page }, testInfo)

  story.given('a webmcpable tool that throws, and a raw one that throws')
  await page.evaluate(async () => {
    await window.webmcpable
      .tools({
        wrapped: {
          description: 'Throws',
          execute: () => {
            throw new Error('out of stock')
          },
        },
      })
      .mount()
    document.modelContext.registerTool({
      description: 'Throws',
      execute: () => {
        throw new Error('raw boom')
      },
      inputSchema: { properties: {}, type: 'object' },
      name: 'raw_thrower',
    } as never)
  })
  const agent = await client(page)

  story.when('a client invokes both')
  const wrapped = await agent.invoke('wrapped')
  const raw = await agent.invoke('raw_thrower')

  story.then('the raw tool fails, and the client is told so')
  expect(raw.status).toBe('Error')

  story.then('webmcpable’s tool reports success carrying the message as its output')
  expect(wrapped.status).toBe('Completed')
  expect(wrapped.output).toBe('Error: out of stock')

  story.then(
    'so a client reading status alone cannot see the failure — the trade for a readable message in the page',
  )
  expect(wrapped.status).not.toBe(raw.status)
})

test('a cancelled invocation is invisible to the page', async ({ page }, testInfo) => {
  story.init({ page }, testInfo)

  story.given('a tool that never resolves and watches the signal it was handed')
  await page.evaluate(async () => {
    window.__aborted = false
    await window.webmcpable
      .tools({
        hang: {
          description: 'Never resolves',
          execute: (_input: unknown, options: { signal: AbortSignal }) => {
            options.signal.addEventListener('abort', () => {
              window.__aborted = true
            })
            return new Promise(() => {})
          },
        },
      })
      .mount()
  })
  const agent = await client(page)

  story.when('a client starts it and then cancels the invocation')
  const invocationId = await agent.start('hang')
  await expect.poll(() => agent.responded(invocationId)).toBeUndefined()
  await agent.cdp.send('WebMCP.cancelInvocation', { invocationId } as never)
  const settled = await agent.settle(invocationId)

  story.then('the client is told the invocation was cancelled')
  expect(settled.status).toBe('Canceled')

  story.then('but the page was never told: the handler is still running, its signal unaborted')
  expect(await page.evaluate(() => window.__aborted)).toBe(false)
})

test('the signal a handler is given aborts when the tool is unregistered', async ({
  page,
}, testInfo) => {
  story.init({ page }, testInfo)

  story.given('a long-running tool whose `when` stops holding while it runs')
  await page.evaluate(async () => {
    window.__aborted = false
    window.__eligible = true
    const registry = window.webmcpable.tools({
      hang: {
        description: 'Never resolves',
        execute: (_input: unknown, options: { signal: AbortSignal }) => {
          options.signal.addEventListener('abort', () => {
            window.__aborted = true
          })
          return new Promise(() => {})
        },
        when: () => window.__eligible,
      },
    })
    await registry.mount()
    window.__registry = registry
  })
  const agent = await client(page)

  story.when('a client starts the call, and the page then revalidates the tool away')
  await agent.start('hang')
  await page.evaluate(async () => {
    window.__eligible = false
    await window.__registry.revalidate()
  })

  story.then('the handler’s signal aborts, so it can stop work the user can no longer reach')
  await expect.poll(() => page.evaluate(() => window.__aborted)).toBe(true)
})

test('a same-origin child frame’s tools never reach the client', async ({ page }, testInfo) => {
  story.init({ page }, testInfo)

  story.given('a child frame, allowed tools, registering one shared name and one of its own')
  await page.goto(FRAMES)
  await expect(page).toHaveTitle('ready')
  await expect(page.frameLocator('#child').locator('body')).toHaveAttribute('data-ready', 'true')

  story.then('the page’s own tool list holds all three registrations — none was refused')
  const inPage = await page.evaluate(async () =>
    (await document.modelContext.getTools()).map((t) => t.name),
  )
  expect(inPage.filter((name) => name === 'duplicate')).toHaveLength(2)
  expect(inPage).toContain('child_only')

  story.when('a client lists what the page advertises')
  const agent = await client(page)

  story.then('only the main frame’s tool is advertised')
  expect(agent.tools.map((t) => t.name)).toEqual(['duplicate'])

  story.then('the child’s uniquely named tool is absent, with no error anywhere')
  expect(agent.tools.some((t) => t.name === 'child_only')).toBe(false)

  story.then('and the advertised record belongs to the main frame')
  const mainFrameId = (
    (await agent.cdp.send('Page.getFrameTree')) as unknown as {
      frameTree: { frame: { id: string } }
    }
  ).frameTree.frame.id
  expect(agent.tools[0]!.frameId).toBe(mainFrameId)
  expect((await agent.invoke('duplicate')).output).toEqual({ scope: 'main' })
})
