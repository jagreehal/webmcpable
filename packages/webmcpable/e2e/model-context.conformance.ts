import { expect, test } from '@playwright/test'
import { story } from 'executable-stories-playwright'
import { MINIMUM_CHROME } from './chrome'

/**
 * Every claim in SPIKE-FINDINGS.md, re-measured against a real Chrome.
 *
 * The unit suite runs against `installTestModelContext()`, which is a
 * transcription of what a browser once did. Nothing keeps a transcription
 * honest except reading the original again, which is this file's whole job.
 * When one of these fails, the fake is wrong — not the browser.
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
      out[tool.name] = await document.modelContext.executeTool(tool, '{}')
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

test('executeTool takes a JSON string and rejects an object', async ({ page }, testInfo) => {
  story.init({ page }, testInfo)

  story.given('a registered tool with an input schema')
  story.when('the agent calls it both ways')
  const result = await page.evaluate(async () => {
    const { tools } = window.webmcpable
    await tools({
      search: { description: 'Search the catalogue', execute: (input) => JSON.stringify(input) },
    }).mount()
    const [tool] = await document.modelContext.getTools()

    const out = {}
    out.jsonString = await document.modelContext.executeTool(tool, JSON.stringify({ q: 'x' }))
    try {
      out.object = await document.modelContext.executeTool(tool, { q: 'x' })
    } catch (error) {
      out.object = `${error.name}: ${error.message}`
    }
    return out
  })

  story.then('a JSON string works')
  expect(result.jsonString).toBe('{"q":"x"}')

  story.then('the object form the draft specifies is rejected')
  expect(result.object).toBe('UnknownError: Failed to parse input arguments')
})

test('a RegisteredTool is shaped the way webmcpable assumes', async ({ page }, testInfo) => {
  story.init({ page }, testInfo)

  story.given('a tool registered with every annotation server-side MCP defines')
  const tool = await page.evaluate(async () => {
    await document.modelContext.registerTool({
      annotations: {
        confirmationHint: true, destructiveHint: true, idempotentHint: true,
        openWorldHint: true, readOnlyHint: true, safetyLevel: 'high',
      },
      description: 'A probe tool with every annotation',
      execute: () => 'ok',
      inputSchema: { properties: {}, type: 'object' },
      name: 'probe',
      // Not in the draft, but the Chrome team's own flight-search demo ships it.
      outputSchema: { properties: { result: { type: 'string' } }, type: 'object' },
    })
    const [registered] = await document.modelContext.getTools()
    let circular = false
    try { JSON.stringify(registered) } catch { circular = true }
    return {
      annotations: registered.annotations,
      circular,
      keys: Object.keys(registered).sort(),
      outputSchema: registered.outputSchema,
      schemaType: typeof registered.inputSchema,
      title: registered.title,
    }
  })

  story.then('inputSchema comes back as a JSON string, not the object the draft types')
  expect(tool.schemaType).toBe('string')

  story.then('only the two annotations the draft defines survive; the rest vanish silently')
  expect(tool.annotations).toEqual({ readOnlyHint: true, untrustedContentHint: false })

  story.then('it carries a Window, so JSON.stringify throws')
  expect(tool.circular).toBe(true)

  story.then('title defaults to an empty string')
  expect(tool.title).toBe('')

  story.then('outputSchema is dropped without an error, the way invented annotations are')
  expect(tool.outputSchema).toBeUndefined()

  story.then('the key set matches the pinned WebIDL')
  expect(tool.keys).toEqual([
    'annotations', 'description', 'inputSchema', 'name', 'origin', 'title', 'window',
  ])
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
      .executeTool(tool, '{}')
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
      .executeTool(tool, '{}')
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
