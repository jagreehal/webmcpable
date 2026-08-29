import { expect, test } from '@playwright/test'
import { story } from 'executable-stories-playwright'

/**
 * The defences from the library's own consent hardening, measured against a
 * real Chrome rather than the fake. A guard that only holds in the test double
 * is not a guard.
 */

test.beforeEach(async ({ page }) => {
  await page.goto('/e2e/fixtures/harness.html')
  await expect(page).toHaveTitle('ready')
})

test('a tool refuses to run once its `when` stops holding', async ({ page }, testInfo) => {
  story.init({ page }, testInfo)

  story.given('a checkout tool registered while the cart has items')
  story.when('the cart empties after the agent has already been offered the tool')
  const outcome = await page.evaluate(async () => {
    const { tools } = window.webmcpable
    let cart = ['a coffee']
    let ran = false
    await tools({
      checkout: {
        description: 'Place the order for everything in the cart',
        handler: () => { ran = true; return 'ordered' },
        when: () => cart.length > 0,
      },
    }).mount()

    const [tool] = await document.modelContext.getTools()
    cart = []
    const result = await document.modelContext.executeTool(tool, '{}')
    return { ran, result }
  })

  story.then('the call is refused in text the agent can read')
  expect(outcome.result).toBe('checkout is not available right now.')

  story.then('the handler never ran')
  expect(outcome.ran).toBe(false)
})

test('a description that changes is re-registered, so the agent never reads a stale one', async ({ page }, testInfo) => {
  story.init({ page }, testInfo)

  story.given('a tool whose description is built from application state')
  story.when('that state changes and the registry revalidates')
  const descriptions = await page.evaluate(async () => {
    const { tools } = window.webmcpable
    const defs = { search: { description: 'Search all products', handler: () => 'ok' } }
    const registry = tools(defs)
    await registry.mount()
    const before = (await document.modelContext.getTools())[0].description

    defs.search.description = 'Search products currently in stock'
    await registry.revalidate()
    const after = (await document.modelContext.getTools())[0].description
    return { after, before }
  })

  story.then('the browser hands the agent the new description')
  expect(descriptions.before).toBe('Search all products')
  expect(descriptions.after).toBe('Search products currently in stock')
})

test('a raw JSON Schema still rejects a call missing a required property', async ({ page }, testInfo) => {
  story.init({ page }, testInfo)

  story.given('a tool typed with plain JSON Schema rather than a Standard Schema')
  story.when('the agent omits a required property')
  const outcome = await page.evaluate(async () => {
    const { tools } = window.webmcpable
    let ran = false
    await tools({
      ship: {
        description: 'Ship the order to an address',
        handler: () => { ran = true; return 'shipped' },
        input: { properties: { address: { type: 'string' } }, required: ['address'], type: 'object' },
      },
    }).mount()
    const [tool] = await document.modelContext.getTools()
    return { ran, result: await document.modelContext.executeTool(tool, '{}') }
  })

  story.then('the agent is told which property is missing')
  expect(outcome.result).toBe('Invalid input — missing required: address')

  story.then('the handler never saw the call')
  expect(outcome.ran).toBe(false)
})
