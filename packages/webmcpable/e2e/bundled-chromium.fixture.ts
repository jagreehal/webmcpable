import { expect, installTestModelContext, test } from 'webmcpable/testing/playwright'

/**
 * What `webmcpable/testing/playwright` claims, measured in the browser it is
 * for: Playwright's bundled Chromium, no flags, no Google Chrome installed.
 *
 * The unit suite runs the same page-side code in happy-dom, which cannot show
 * that `addInitScript` really serialises it or that a DOMException really
 * survives the trip back. That is this lane's job.
 */

const APP = '/e2e/fixtures/app.html'

test('bundled Chromium carries no WebMCP of its own', async ({ browser }) => {
  // A page the fixture never touched. If this ever finds a modelContext, every
  // other test here is measuring the browser instead of the fake.
  const bare = await browser.newPage()
  await bare.goto(APP)

  expect(await bare.evaluate(() => typeof document.modelContext)).toBe('undefined')

  await bare.close()
})

test('the application mounts, name-sorted, with the schema already parsed', async ({
  modelContext,
  page,
}) => {
  await page.goto(APP)
  await expect(page).toHaveTitle('ready')
  const listed = await modelContext.getTools()

  expect(listed.map((tool) => tool.name)).toEqual(['add_to_cart', 'cart_total', 'out_of_stock'])
  // The trip through the browser is where a JSON-string schema would survive as
  // a string and quietly fail every `.properties` assertion downstream.
  expect(listed[0]!.inputSchema).toMatchObject({
    properties: { qty: { type: 'number' }, sku: { type: 'string' } },
    required: ['sku'],
    type: 'object',
  })
  expect(listed[1]!.annotations).toEqual({ readOnlyHint: true, untrustedContentHint: false })
})

test('a tool call moves what the user sees', async ({ modelContext, page }) => {
  await page.goto(APP)
  await expect(page).toHaveTitle('ready')

  const result = await modelContext.callTool('add_to_cart', { qty: 2, sku: 'espresso' })

  expect(JSON.parse(result)).toEqual({ sku: 'espresso', total: 2 })
  // The assertion that carries the weight: a tool reporting success over a cart
  // that never changed has told the agent a lie, and only this catches it.
  await expect(page.getByTestId('cart-count')).toHaveText('2')
})

test('the agent and the user share one cart', async ({ modelContext, page }) => {
  await page.goto(APP)
  await expect(page).toHaveTitle('ready')

  await page.getByTestId('add').click()
  await modelContext.callTool('add_to_cart', { sku: 'espresso' })

  expect(JSON.parse(await modelContext.callTool('cart_total'))).toEqual({ total: 2 })
  await expect(page.getByTestId('cart-count')).toHaveText('2')
})

test('every invocation is recorded, in order, with its input', async ({ modelContext, page }) => {
  await page.goto(APP)
  await expect(page).toHaveTitle('ready')

  await modelContext.callTool('add_to_cart', { qty: 2, sku: 'espresso' })
  await modelContext.callTool('cart_total')

  expect(await modelContext.calls()).toEqual([
    { input: { qty: 2, sku: 'espresso' }, name: 'add_to_cart', result: '{"sku":"espresso","total":2}' },
    { input: {}, name: 'cart_total', result: '{"total":2}' },
  ])
})

test('a handler that throws reaches the agent as text, not a rejection', async ({
  modelContext,
  page,
}) => {
  await page.goto(APP)
  await expect(page).toHaveTitle('ready')

  // Chrome discards a thrown message, so webmcpable returns it instead. The
  // point of measuring it here is that the text survives the page boundary.
  expect(await modelContext.callTool('out_of_stock')).toBe('Error: the espresso ran out')
})

test('an unknown tool names itself in the failure', async ({ modelContext, page }) => {
  await page.goto(APP)
  await expect(page).toHaveTitle('ready')

  await expect(modelContext.callTool('checkout')).rejects.toThrow(
    'No tool named "checkout" is registered on this page.',
  )
})

test('the recorded calls belong to one document', async ({ modelContext, page }) => {
  await page.goto(APP)
  await modelContext.callTool('add_to_cart', { sku: 'espresso' })
  expect(await modelContext.calls()).toHaveLength(1)

  await page.goto(APP)

  // A fresh document gets a fresh fake, so the list starts again — and the init
  // script has to have run a second time for the app to mount at all.
  await expect(page).toHaveTitle('ready')
  expect(await modelContext.calls()).toEqual([])
})

test('installTestModelContext works on a page the fixture never made', async ({ browser }) => {
  // The bring-your-own-fixtures path: a suite with its own `test.extend` chain
  // reaches for the primitive instead of this module's `test`.
  const own = await browser.newPage()
  const modelContext = await installTestModelContext(own)

  await own.goto(APP)
  await expect(own).toHaveTitle('ready')
  expect(await modelContext.callTool('add_to_cart', { sku: 'espresso' })).toBe(
    '{"sku":"espresso","total":1}',
  )

  await own.close()
})
