import { expect, test } from '@playwright/test'
import { story } from 'executable-stories-playwright'
import { MINIMUM_CHROME } from './chrome'

/**
 * Every claim the in-memory fake makes, re-measured against a real Chrome.
 *
 * The unit suite runs against `installTestModelContext()`, which is a
 * transcription of what a browser once did. Nothing keeps a transcription
 * honest except reading the original again, which is this file's whole job.
 * When one of these fails, update the fake to match the browser.
 */

const HARNESS = '/e2e/fixtures/harness.html'

test.beforeEach(async ({ page }) => {
  await page.goto(HARNESS)
  await expect(page).toHaveTitle('ready')
})

test('Chrome is new enough to carry the WebMCP implementation', async ({ page }, testInfo) => {
  story.init({ page }, testInfo)

  story.given('a Chrome launched with the WebMCP flags')
  const version = await page.evaluate(
    () => Number(navigator.userAgent.match(/Chrome\/(\d+)/)?.[1] ?? 0),
  )

  story.then(`the major version is at least ${MINIMUM_CHROME}`)
  expect(version).toBeGreaterThanOrEqual(MINIMUM_CHROME)

  story.then('document.modelContext is present')
  expect(await page.evaluate(() => typeof document.modelContext)).toBe('object')
})

test('the navigator aliases are gone', async ({ page }, testInfo) => {
  story.init({ page }, testInfo)

  story.given('Chrome 152, where the draft moved to document.modelContext')

  story.then('navigator.modelContext no longer aliases it')
  expect(await page.evaluate(() => typeof navigator.modelContext)).toBe('undefined')

  story.then('the undocumented navigator.modelContextTesting is also gone')
  expect(await page.evaluate(() => typeof navigator.modelContextTesting)).toBe('undefined')
})

test('a handler result reaches the agent as a string', async ({ page }, testInfo) => {
  story.init({ page }, testInfo)

  story.given('tools registered through webmcpable, each returning a different shape')
  story.when('the agent executes each one')
  const results = await page.evaluate(async () => {
    const { tools } = window.webmcpable
    await tools({
      envelope: { description: 'Returns an MCP envelope', execute: () => ({ content: [{ text: 'hi', type: 'text' }] }) },
      object: { description: 'Returns a plain object', execute: () => ({ a: 1 }) },
      text: { description: 'Returns a string', execute: () => 'Added' },
      thrower: { description: 'Throws an error', execute: () => { throw new Error('out of stock') } },
      voider: { description: 'Returns undefined', execute: () => undefined },
    }).mount()

    const registered = await document.modelContext.getTools()
    const out = {}
    for (const tool of registered) {
      out[tool.name] = await document.modelContext.executeTool(tool, {})
    }
    return out
  })

  story.then('a string passes through untouched')
  expect(results.text).toBe('Added')

  story.then('a plain object is serialised')
  expect(results.object).toBe('{"a":1}')

  story.then('an MCP envelope is NOT unwrapped — the agent gets the wrapper')
  expect(results.envelope).toBe('{"content":[{"text":"hi","type":"text"}]}')

  story.then('undefined becomes an empty result, because webmcpable normalises it')
  expect(results.voider).toBe('Operation succeeded')

  story.then('a thrown message survives, because webmcpable returns it as text')
  expect(results.thrower).toBe('Error: out of stock')
})

test('executeTool takes an object and rejects a JSON string', async ({ page }, testInfo) => {
  story.init({ page }, testInfo)

  story.given('a registered tool with an input schema')
  story.when('the agent calls it each way')
  const result = await page.evaluate(async () => {
    const { tools } = window.webmcpable
    await tools({
      search: { description: 'Search the catalogue', execute: (input) => JSON.stringify(input) },
    }).mount()
    const [tool] = await document.modelContext.getTools()

    const attempt = async (input) => {
      try {
        return await document.modelContext.executeTool(tool, input)
      } catch (error) {
        return `${error.name}: ${error.message}`
      }
    }
    return {
      array: await attempt([1]),
      jsonString: await attempt(JSON.stringify({ q: 'x' })),
      object: await attempt({ q: 'x' }),
      omitted: await attempt(undefined),
      toJSON: await attempt({ toJSON() {} }),
    }
  })

  story.then('the object form the draft specifies works')
  expect(result.object).toBe('{"q":"x"}')

  story.then('the JSON string Chrome 152-154 required is now a TypeError')
  expect(result.jsonString).toBe(
    "TypeError: Failed to execute 'executeTool' on 'ModelContext': parameter 2 is not of type 'object'.",
  )

  story.then('a toJSON that returns undefined is a TypeError')
  expect(result.toJSON).toBe(
    "TypeError: Failed to execute 'executeTool' on 'ModelContext': invalid input object: toJSON() returns undefined",
  )

  story.then('omitted input arrives as an empty object, and an array passes through')
  expect(result.omitted).toBe('{}')
  expect(result.array).toBe('[1]')
})

test('executeTool serialises input through JSON', async ({ page }, testInfo) => {
  story.init({ page }, testInfo)

  story.given('a raw tool that echoes the input its handler received')
  story.when('the agent passes values JSON cannot represent faithfully')
  const result = await page.evaluate(async () => {
    await document.modelContext.registerTool({
      description: 'Echo the input',
      execute: (input) => JSON.stringify(input),
      inputSchema: { type: 'object' },
      name: 'echo',
    } as never)
    const [tool] = await document.modelContext.getTools()
    const attempt = async (input) => {
      try {
        return await document.modelContext.executeTool(tool, input)
      } catch (error) {
        return `${error.name}: ${error.message.split('\n')[0]}`
      }
    }
    const circular: Record<string, unknown> = {}
    circular['self'] = circular
    return {
      bigint: await attempt({ b: 1n }),
      circular: await attempt(circular),
      date: await attempt({ d: new Date(0) }),
      nan: await attempt({ i: Number.POSITIVE_INFINITY, n: Number.NaN }),
      undef: await attempt({ k: 1, u: undefined }),
    }
  })

  story.then('a Date arrives as its ISO string')
  expect(result.date).toBe('{"d":"1970-01-01T00:00:00.000Z"}')

  story.then('NaN and Infinity arrive as null')
  expect(result.nan).toBe('{"i":null,"n":null}')

  story.then('an undefined property is dropped')
  expect(result.undef).toBe('{"k":1}')

  story.then('a circular object and a BigInt are TypeErrors')
  expect(result.circular).toBe(
    "TypeError: Failed to execute 'executeTool' on 'ModelContext': Converting circular structure to JSON",
  )
  expect(result.bigint).toBe(
    "TypeError: Failed to execute 'executeTool' on 'ModelContext': Do not know how to serialize a BigInt",
  )
})

test('registerTool snapshots inputSchema through JSON', async ({ page }, testInfo) => {
  story.init({ page }, testInfo)

  story.given('schemas with a toJSON, values JSON cannot hold, and one mutated after registering')
  story.when('the agent lists them')
  const schemas = await page.evaluate(async () => {
    const mutable = { properties: { a: { type: 'string' } }, type: 'object' }
    const register = (name, inputSchema) =>
      document.modelContext.registerTool({ description: 'x', execute: () => 'ok', inputSchema, name } as never)
    await register('lossy', { d: new Date(0), n: Number.NaN, type: 'object', u: undefined })
    await register('mutated', mutable)
    await register('tojson', { toJSON: () => ({ type: 'object' }) })
    await document.modelContext.registerTool({ description: 'x', execute: () => 'ok', name: 'none' } as never)
    mutable.properties.a.type = 'number'
    return Object.fromEntries(
      (await document.modelContext.getTools()).map((t) => [t.name, t.inputSchema ?? 'absent']),
    )
  })

  story.then('getTools returns the JSON taken at registration: toJSON applied, Date a string, NaN null, undefined gone, later mutation unseen')
  expect(schemas).toEqual({
    lossy: { d: '1970-01-01T00:00:00.000Z', n: null, type: 'object' },
    mutated: { properties: { a: { type: 'string' } }, type: 'object' },
    none: 'absent',
    tojson: { type: 'object' },
  })
})

test('execute receives a signal that a caller’s abort leaves alone', async ({ page }, testInfo) => {
  story.init({ page }, testInfo)

  story.given('a raw tool that never resolves and records its arguments')
  story.when('a caller starts it, then aborts its own signal')
  const out = await page.evaluate(async () => {
    const seen: { argc?: number; signal?: AbortSignal } = {}
    await document.modelContext.registerTool({
      description: 'Hangs',
      execute: (...args: Array<unknown>) => {
        seen.argc = args.length
        seen.signal = (args[1] as { signal: AbortSignal }).signal
        return new Promise(() => {})
      },
      inputSchema: { properties: {}, type: 'object' },
      name: 'hang',
    } as never)
    const [tool] = await document.modelContext.getTools()
    const caller = new AbortController()
    const pending = document.modelContext.executeTool(tool, {}, { signal: caller.signal })
    await new Promise((resolve) => setTimeout(resolve, 50))
    caller.abort()
    const rejectedWithReason = await pending.then(() => false, (error) => error === caller.signal.reason)
    return {
      argc: seen.argc,
      handlerAborted: seen.signal?.aborted,
      isSignal: typeof seen.signal?.addEventListener === 'function',
      rejectedWithReason,
    }
  })

  story.then('execute received the input and an options object carrying an AbortSignal')
  expect(out.argc).toBe(2)
  expect(out.isSignal).toBe(true)

  story.then('executeTool rejects with the caller’s reason')
  expect(out.rejectedWithReason).toBe(true)

  story.then('and the handler’s signal stays unaborted: only a CDP cancel reaches it')
  expect(out.handlerAborted).toBe(false)
})

test('a Tool is shaped the way webmcpable assumes', async ({ page }, testInfo) => {
  story.init({ page }, testInfo)

  story.given('a tool registered with debugging and every annotation server-side MCP defines, and one with neither')
  const tool = await page.evaluate(async () => {
    await document.modelContext.registerTool({ description: 'x', execute: () => 'ok', name: 'bare' })
    await document.modelContext.registerTool({
      annotations: {
        confirmationHint: true, debugging: true, destructiveHint: true, idempotentHint: true,
        openWorldHint: true, readOnlyHint: true, safetyLevel: 'high',
      },
      description: 'A probe tool with every annotation',
      execute: () => 'ok',
      inputSchema: { properties: {}, type: 'object' },
      name: 'probe',
      outputSchema: { type: 'string' },
    } as never)
    const [bare, probe] = await document.modelContext.getTools()
    let cloned = 'cloned'
    try { structuredClone(probe) } catch (error) { cloned = error.name }
    return {
      annotations: probe.annotations,
      bare: [bare.inputSchema, bare.outputSchema, bare.annotations],
      chrome: Number(navigator.userAgent.match(/Chrome\/(\d+)/)?.[1] ?? 0),
      cloned,
      json: JSON.stringify(probe),
      outputSchema: probe.outputSchema,
      schemaType: typeof probe.inputSchema,
      source: probe.source === window,
      spread: Object.keys({ ...probe }),
      title: probe.title,
      window: probe.window === window,
    }
  })

  story.then('inputSchema comes back as an object, as the draft types it')
  expect(tool.schemaType).toBe('object')

  story.then('Chrome returns its hints with defaults and drops server-side MCP names')
  expect(tool.annotations).toEqual({
    consequentialHint: false, debugging: true, readOnlyHint: true, untrustedContentHint: false,
  })

  story.then('its members are getters: JSON.stringify gives {}, spread copies nothing, structuredClone throws')
  expect(tool.json).toBe('{}')
  expect(tool.spread).toEqual([])
  expect(tool.cloned).toBe('DataCloneError')

  story.then('title defaults to an empty string')
  expect(tool.title).toBe('')

  story.then('from 160 it carries source and outputSchema; before that, window and no outputSchema')
  const is160 = tool.chrome >= 160
  expect(tool.source).toBe(is160)
  expect(tool.window).toBe(!is160)
  expect(tool.outputSchema).toEqual(is160 ? { type: 'string' } : undefined)

  story.then('what was not sent is null')
  expect(tool.bare).toEqual([null, is160 ? null : undefined, null])
})

test('tools() passes outputSchema on and holds readiness while it registers', async ({ page }, testInfo) => {
  story.init({ page }, testInfo)

  story.given('two tools registered through webmcpable, one with an output schema')
  const out = await page.evaluate(async () => {
    const mc = document.modelContext
    const held: Array<Promise<unknown>> = []
    const native = mc.waitForToolsUntil
    if (native) {mc.waitForToolsUntil = (promise) => { held.push(promise); native.call(mc, promise) }}
    let unhandled = 0
    addEventListener('unhandledrejection', () => unhandled++)
    const registry = window.webmcpable.tools({
      a: { description: 'Counts', execute: () => ({ n: 1 }), outputSchema: { properties: { n: { type: 'number' } }, type: 'object' } },
      b: { description: 'Plain', execute: () => 'ok' },
    })
    await registry.mount()
    await registry.revalidate()
    await Promise.all(held)
    native?.call(mc, Promise.reject(new Error('late')))
    native?.call(mc, new Promise(() => {}))
    const [a] = await mc.getTools()
    await new Promise((resolve) => setTimeout(resolve, 50))
    return {
      chrome: Number(navigator.userAgent.match(/Chrome\/(\d+)/)?.[1] ?? 0),
      held: held.length,
      outputSchema: a.outputSchema,
      result: await mc.executeTool(a, {}),
      unhandled,
    }
  })
  const is160 = out.chrome >= 160

  story.then('from 160 the browser returns the output schema')
  expect(out.outputSchema).toEqual(
    is160 ? { properties: { n: { type: 'number' } }, type: 'object' } : undefined,
  )
  expect(out.result).toBe('{"n":1}')

  story.then('from 160 mount holds readiness once, and a sync that registers no tools leaves it alone')
  expect(out.held).toBe(is160 ? 1 : 0)

  story.then('the browser handles a rejected promise, and getTools in the page does not wait for a pending one')
  expect(out.unhandled).toBe(0)
})

test('executeTool runs the registration getTools returned', async ({ page }, testInfo) => {
  story.init({ page }, testInfo)

  story.given('a Tool whose registration ended and whose name was registered again')
  story.when('the agent executes it, and a copy of a live one')
  const errors = await page.evaluate(async () => {
    const mc = document.modelContext
    const attempt = (tool) => mc.executeTool(tool, {}).catch((error) => `${error.name}: ${error.message}`)
    const controller = new AbortController()
    const definition = { description: 'x', execute: () => 'ran', name: 'a' }
    await mc.registerTool(definition, { signal: controller.signal })
    const [stale] = await mc.getTools()
    controller.abort()
    await mc.registerTool(definition)
    const [fresh] = await mc.getTools()
    return { copy: await attempt({ ...fresh }), fresh: await attempt(fresh), stale: await attempt(stale) }
  })

  story.then('the stale Tool is a NotFoundError, even with the name taken again')
  expect(errors.stale).toBe('NotFoundError: The requested tool was not found or is not accessible.')

  story.then('a copy is a TypeError')
  expect(errors.copy).toBe(
    "TypeError: Failed to execute 'executeTool' on 'ModelContext': parameter 1 is not of type 'Tool'.",
  )

  story.then('a fresh one runs')
  expect(errors.fresh).toBe('ran')
})

test('registration rejects the same things the fake rejects', async ({ page }, testInfo) => {
  story.init({ page }, testInfo)

  story.given('a series of invalid tool definitions')
  story.when('each is registered')
  const errors = await page.evaluate(async () => {
    const attempt = async (tool, options) => {
      try {
        await document.modelContext.registerTool(tool, options)
        return 'ACCEPTED'
      } catch (error) {
        return error.name
      }
    }
    const valid = { description: 'a valid description', execute: () => 'ok' }
    return {
      badName: await attempt({ ...valid, name: 'has space' }),
      duplicate: await attempt({ ...valid, name: 'dupe' }).then(() => attempt({ ...valid, name: 'dupe' })),
      emptyDescription: await attempt({ ...valid, description: '', name: 'a' }),
      emptyName: await attempt({ ...valid, name: '' }),
      executeNotAFunction: await attempt({ ...valid, execute: 'nope', name: 'b' }),
      unserialisableSchema: await attempt({ ...valid, inputSchema: { n: 1n }, name: 'c' }),
      untrustedOrigin: await attempt({ ...valid, name: 'd' }, { exposedTo: ['http://evil.example'] }),
    }
  })

  story.then('an invalid name is an InvalidStateError')
  expect(errors.emptyName).toBe('InvalidStateError')
  expect(errors.badName).toBe('InvalidStateError')

  story.then('an empty description and a duplicate name are too')
  expect(errors.emptyDescription).toBe('InvalidStateError')
  expect(errors.duplicate).toBe('InvalidStateError')

  story.then('a non-function execute is a TypeError — it is a required WebIDL member')
  expect(errors.executeNotAFunction).toBe('TypeError')

  story.then('an unserialisable schema is a TypeError')
  expect(errors.unserialisableSchema).toBe('TypeError')

  story.then('an untrustworthy exposedTo origin is a SecurityError')
  expect(errors.untrustedOrigin).toBe('SecurityError')
})

test('getTools returns lexicographical order, not registration order', async ({ page }, testInfo) => {
  story.init({ page }, testInfo)

  story.given('three tools registered out of alphabetical order')
  story.when('the agent lists them')
  const names = await page.evaluate(async () => {
    const { tools } = window.webmcpable
    await tools({
      zebra: { description: 'Registered first', execute: () => 'ok' },
      apple: { description: 'Registered second', execute: () => 'ok' },
      mango: { description: 'Registered third', execute: () => 'ok' },
    }).mount()
    return (await document.modelContext.getTools()).map((t) => t.name)
  })

  story.then('they come back sorted by name')
  expect(names).toEqual(['apple', 'mango', 'zebra'])
})

test('a navigating tool keeps a synchronous result and loses an awaited one', async ({ page }, testInfo) => {
  story.init({ page }, testInfo)

  story.given('two tools that navigate away, one returning at once and one awaiting first')
  await page.evaluate(async () => {
    const { tools } = window.webmcpable
    await tools({
      at_once: {
        description: 'Navigate, returning the result in the same turn',
        execute: () => {
          location.href = '/e2e/fixtures/landing.html?at_once'
          return 'Opening the landing page'
        },
      },
    }).mount()
  })

  story.when('the agent calls the one that returns in the same turn')
  await page.evaluate(async () => {
    const [tool] = await document.modelContext.getTools()
    // Not awaited: this document is about to be replaced. The handler records
    // its own outcome in sessionStorage, which survives a same-origin navigation.
    void document.modelContext
      .executeTool(tool, {})
      .then((result) => sessionStorage.setItem('outcome', `resolved:${result}`))
      .catch((error) => sessionStorage.setItem('outcome', `rejected:${error.name}`))
  })
  await page.waitForURL('**/landing.html?at_once')

  story.then('the result was delivered before the unload')
  expect(await page.evaluate(() => sessionStorage.getItem('outcome'))).toBe(
    'resolved:Opening the landing page',
  )

  story.when('the same call awaits anything after navigating')
  await page.goto(HARNESS)
  await expect(page).toHaveTitle('ready')
  await page.evaluate(async () => {
    sessionStorage.removeItem('outcome')
    const { tools } = window.webmcpable
    await tools({
      after_await: {
        description: 'Navigate, then finish work before returning',
        execute: async () => {
          location.href = '/e2e/fixtures/landing.html?after_await'
          await new Promise((resolve) => setTimeout(resolve, 50))
          return 'Opening the landing page'
        },
      },
    }).mount()
  })
  await page.evaluate(async () => {
    const [tool] = await document.modelContext.getTools()
    void document.modelContext
      .executeTool(tool, {})
      .then((result) => sessionStorage.setItem('outcome', `resolved:${result}`))
      .catch((error) => sessionStorage.setItem('outcome', `rejected:${error.name}`))
  })
  await page.waitForURL('**/landing.html?after_await')

  story.then('nothing was recorded: the unload took the result with it')
  expect(await page.evaluate(() => sessionStorage.getItem('outcome'))).toBeNull()
})

test('exposedTo takes secure origins only, and has no wildcard', async ({ page }, testInfo) => {
  story.init({ page }, testInfo)

  story.given('the same tool offered to four different origin lists')
  story.when('each registration is attempted')
  const outcomes = await page.evaluate(async () => {
    const attempt = async (exposedTo, name) => {
      try {
        await document.modelContext.registerTool(
          { description: 'A probe tool', execute: () => 'ok', name },
          { exposedTo },
        )
        return 'registered'
      } catch (error) {
        return `${error.name}: ${error.message}`
      }
    }
    return {
      insecure: await attempt(['http://partner.example'], 'a'),
      ipv4Loopback: await attempt(['http://127.0.0.2'], 'e'),
      ipv6Loopback: await attempt(['http://[::1]'], 'f'),
      localhost: await attempt(['http://localhost:5173'], 'b'),
      secure: await attempt(['https://trusted.example'], 'c'),
      subLocalhost: await attempt(['http://app.localhost'], 'g'),
      wildcard: await attempt(['*'], 'd'),
    }
  })

  story.then('an https origin is accepted, and so is localhost')
  expect(outcomes.secure).toBe('registered')
  expect(outcomes.localhost).toBe('registered')

  story.then('loopback is the whole 127.0.0.0/8 block, ::1, and any .localhost')
  expect(outcomes.ipv4Loopback).toBe('registered')
  expect(outcomes.ipv6Loopback).toBe('registered')
  expect(outcomes.subLocalhost).toBe('registered')

  story.then('a plain http origin is refused')
  expect(outcomes.insecure).toBe(
    'SecurityError: Only secure origins are allowed in the exposedTo list.',
  )

  story.then('there is no wildcard — "*" is refused the same way')
  expect(outcomes.wildcard).toBe(
    'SecurityError: Only secure origins are allowed in the exposedTo list.',
  )
})
