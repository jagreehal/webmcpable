import { expect, test } from '@playwright/test'
import { story } from 'executable-stories-playwright'

/**
 * The declarative half of WebMCP, which the browser owns end to end.
 *
 * `webmcpable` does not implement any of it, but it ships the attribute types
 * and shares a namespace with it — so what a `<form toolname>` does to an
 * imperative registration is this package's problem whether it likes it or not.
 */

const HARNESS = '/e2e/fixtures/declarative.html'

test.beforeEach(async ({ page }) => {
  await page.goto(HARNESS)
  await expect(page).toHaveTitle('ready')
})

test('a <form toolname> is a tool like any other', async ({ page }, testInfo) => {
  story.init({ page }, testInfo)

  story.given('a form carrying toolname and tooldescription, and no script')
  story.when('the agent lists the tools')
  const listed = await page.evaluate(async () =>
    (await document.modelContext.getTools()).map((t) => ({
      description: t.description,
      name: t.name,
      schemaType: typeof t.inputSchema,
    })),
  )

  story.then('the browser has registered it, indistinguishable from an imperative tool')
  expect(listed).toEqual([
    {
      description: 'Book a table for tonight',
      name: 'book_table',
      schemaType: 'string',
    },
  ])
})

test('a form and a registered tool cannot share a name', async ({ page }, testInfo) => {
  story.init({ page }, testInfo)

  story.given('a page whose form already claims "book_table"')
  story.when('the page registers a tool of the same name through webmcpable')
  const outcome = await page.evaluate(async () => {
    try {
      await window.webmcpable
        .tools({ book_table: { description: 'Imperative twin of the form', execute: () => 'ours' } })
        .mount()
      return 'registered'
    } catch (error) {
      return error.message
    }
  })

  story.then('the browser refuses it, and webmcpable says which name lost')
  expect(outcome).toBe(
    'webmcpable could not register "book_table": InvalidStateError: Duplicate tool name',
  )

  story.then('the form keeps the name — the imperative tool is simply absent')
  const listed = await page.evaluate(async () =>
    (await document.modelContext.getTools()).map((t) => t.description),
  )
  expect(listed).toEqual(['Book a table for tonight'])
})

test('a declarative tool without toolautosubmit waits for the human', async ({ page }, testInfo) => {
  story.init({ page }, testInfo)

  story.given('a form with no toolautosubmit attribute')
  story.when('the agent executes it and waits three seconds')
  const outcome = await page.evaluate(async () => {
    const [tool] = await document.modelContext.getTools()
    return Promise.race([
      document.modelContext.executeTool(tool, JSON.stringify({ people: '2' })),
      new Promise((resolve) => setTimeout(() => resolve('still waiting'), 3000)),
    ])
  })

  story.then('nothing comes back: the call is parked until someone presses the button')
  expect(outcome).toBe('still waiting')
})
