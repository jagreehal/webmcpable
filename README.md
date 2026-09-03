# webmcpable

[![npm](https://img.shields.io/npm/v/webmcpable)](https://www.npmjs.com/package/webmcpable)
[![license](https://img.shields.io/npm/l/webmcpable)](#licence)

**Let AI agents use your web app.** Declare your app's actions as tools an agent
can call. They run in the page, on your existing application logic, in the
user's session.

```bash
npm install webmcpable
```

Writing these tools with a coding agent? The package ships
[`SKILL.md`](./packages/webmcpable/SKILL.md) — point your agent at
`node_modules/webmcpable/SKILL.md`, or copy it to
`.claude/skills/webmcpable/SKILL.md`.

## What WebMCP is

Ask an agent to buy something and watch what it does. It screenshots the page,
looks for something resembling a button, clicks, waits, screenshots again. It
reads your screen the way you would, slower, and you pay tokens every time it
looks. Ship a redesign and it breaks.

Your site already knows it has a search, a cart, and a checkout flow. None of
that is written down where a program can read it. The layout describes it to
people and to nobody else.

WebMCP is a browser API from the Chrome and Edge teams that lets your page write
those actions down. Each action gets a name, a description a model reads, and a
schema for its inputs. The agent calls them instead of inferring them from
pixels.

That change buys you three things:

- **The user's session, with no keys.** The tool runs in the open tab. Your user
  has signed in, so the agent already has whatever access they have. You
  provision nothing and hand out no tokens.
- **An action list that follows the page.** A signed-out visitor's agent sees
  search and product lookup. After sign-in the same site offers order history
  and checkout. The agent reads the list again.
- **Portability across models.** Inputs use JSON Schema, the format Claude, GPT,
  and Gemini already accept for tool calls. Describe an action once.

## Can you use this today?

Chrome 151 ships WebMCP behind an origin trial and Edge is building it. The
draft spec still moves.

`webmcpable` is safe to ship now. `mount()` and `revalidate()` do nothing when
the browser has no `document.modelContext`, so users on every other browser
carry no cost. To build against WebMCP without a supporting browser, use the
in-memory harness in [`webmcpable/testing`](#test-without-a-supporting-browser),
and [`webmcpable/testing/playwright`](#end-to-end-in-playwright) for
end-to-end tests.

Two things this library leaves alone. It does not bridge desktop MCP clients to
your page, and it does not polyfill WebMCP. The browser owns declarative
`<form toolname>` support. If you mix the two, reference the attribute types so
TypeScript accepts them:

```ts
/// <reference types="webmcpable/declarative" />
```

A form registers a tool as surely as `registerTool` does, and the browser
refuses a name that is already taken — so `tools()` reports
`webmcpable could not register "book_table": InvalidStateError: Duplicate tool
name`, and the form keeps the name. A declarative tool without `toolautosubmit`
also parks the agent's call until a human presses the button. Both measured in
[`e2e/declarative.conformance.ts`](./packages/webmcpable/e2e/declarative.conformance.ts).

## Your first tool

```ts
import { tools } from 'webmcpable'
import * as z from 'zod'

const registry = tools({
  checkout: {
    description: 'Check out the current cart and place the order.',
    when: () => cart.items.length > 0,        // only offered when it is possible
    input: z.object({ address: z.string().describe('Delivery address') }),
    execute: ({ address }) => placeOrder(address),
  },
})

await registry.mount()
```

`webmcpable` infers the type of `address` from the schema and validates the
agent's input before your handler runs. The browser exposes `checkout` only
while the cart holds an item.

## Why not call the browser API directly

You can. `document.modelContext.registerTool()` is a plain function and needs no
library. The catch is that Chrome 151 diverges from the draft in several places,
and each divergence turns a small mistake into a silent one.

Behavior measured in Chrome 151:

| You write | The agent receives |
| --- | --- |
| `return { content: [{ type: 'text', text: 'Added' }] }` | `{"content":[{"type":"text","text":"Added"}]}`, the wrapper, unparsed |
| `return undefined` | `"undefined"`, the literal nine characters |
| `throw new Error('out of stock')` | `UnknownError: Tool was executed but the invocation failed` |
| `annotations: { destructiveHint: true }` | *nothing*. Discarded at registration |
| `executeTool(tool, { q: 'x' })` | `UnknownError: Failed to parse input arguments` |

`webmcpable` normalizes handler results and errors, validates Standard Schema
input before your handler sees it, and restricts annotations to the fields
WebMCP defines. The test harness and CLI reproduce or detect invocation
mistakes such as passing object arguments to `executeTool()`.

[spike/SPIKE-FINDINGS.md](https://github.com/jagreehal/webmcpable/blob/main/spike/SPIKE-FINDINGS.md)
records every measurement behind this table, names the file that encodes each
one, and explains how to re-run them against a newer Chrome.

### Tool results

A handler returns a string, a JSON-compatible value, or `undefined`.
`webmcpable` passes strings through, serializes other values as JSON, and maps
`undefined` to an empty result. Chrome presents that empty result as
`"Operation succeeded"`.

Chrome replaces a thrown error with a generic `UnknownError`. `webmcpable`
catches it and returns `Error: <message>`, so the agent reads what went wrong.

### Return what changed, not that something changed

`"Filters updated"` forces the agent to call another tool to find out what it
did, and that second call races your UI: it can read the page before the
framework has rendered your change. Return the new state from the tool that
made it and the race is gone.

```ts
set_filters: {
  description: 'Filter the flight results.',
  input: z.object({ maxPrice: z.number() }),
  execute: ({ maxPrice }) => {
    const flights = applyFilters({ maxPrice })
    return { count: flights.length, flights }   // not 'Filters updated'
  },
}
```

### Tools that navigate

A tool that navigates unloads the document that still owes the agent a result.
Measured in Chrome 152: a value returned in the same turn as the assignment
arrives, and anything awaited after it is lost with no error on either side.
Do not rely on the first half — resolve first, navigate from a task:

```ts
view_product: {
  description: 'Open the page for a product.',
  input: z.object({ id: z.string() }),
  execute: ({ id }) => {
    setTimeout(() => location.assign(`/product/${id}`), 0)
    return `Opening ${id}.`
  },
}
```

`doctor` flags a tool that navigates without deferring. Client-side routers are
fine — nothing unloads. Call `mount()` again on the page you land on.

## The path an agent actually takes

Everything above describes the page's side. An agent is not in the page. Chrome
exposes WebMCP to a client over a CDP `WebMCP` domain — `toolsAdded`,
`invokeTool`, `cancelInvocation`, `toolResponded` — and the reference client is
[agent-browser](https://github.com/vercel-labs/agent-browser), whose
`agent-browser webmcp list | invoke | result | cancel` is what calling your page
looks like from outside.

That crossing has rules the in-page API does not, all measured in
[`e2e/cdp.conformance.ts`](./packages/webmcpable/e2e/cdp.conformance.ts):

| In the page | What a client sees |
| --- | --- |
| `return { count: 3 }` | `output: { "count": 3 }` — structured. Chrome parses the JSON `webmcpable` serialised |
| `return 'Added'` | `output: "Added"` |
| `return undefined` | `output: "Operation succeeded"` |
| `throw new Error('out of stock')` | `status: "Completed"`, `output: "Error: out of stock"` |
| a tool registered in a same-origin child frame | *nothing*. Never advertised |

The fourth row is a trade rather than a bug. Chrome replaces a thrown message
with a generic `UnknownError` on the in-page path, so `webmcpable` catches and
returns the text — which is the only way an agent reads what went wrong. The
cost is that a client watching `status` alone sees success. A tool that throws
without the library reports `status: "Error"`, and an unreadable message.

### Your handler's second argument

`execute` is typed `(input, { signal })`, and Chrome calls a registered
`execute` with **one argument**. `webmcpable` supplies the second itself, so the
documented signature works; called directly, `registerTool` would hand your
handler `undefined` and a destructure would throw.

That `signal` is the tool's *registration*. It aborts when the tool is
unregistered — `unmount()`, or a `revalidate()` where `when` stopped holding —
so a long-running handler can drop work the user can no longer reach.

It is not a per-call cancellation. A client can cancel an invocation, and
Chrome tells the client it was `Canceled` while telling the page nothing: the
handler keeps running, its promise never settles, its signal never fires. Do
not leave a handler waiting on something that may never arrive.

### Tools in an iframe

A child frame needs `allow="tools"` before it may register at all. Even with
it, a same-origin child's tools reach the page's own `getTools()` and are never
advertised to a client attached to the top-level page — no error on either
side. Register from the top-level document. A cross-origin child is a separate
target with its own tool set, which only a client that attaches per-frame will
read.

### What a client refuses

`agent-browser` caps input at 1 MB, output at 2 MB, a tool record at 256 KB and
the list at 512 tools, and returns `webmcp_output_too_large` rather than
truncating. Returning the state you changed is still right — return the fields
the agent needs, not every row you have.

## Tools that follow page state

A tool the agent cannot use is worse than no tool. `when:` decides whether to
offer each one, so an empty cart hides `checkout` instead of failing it.

```ts
tools({
  view_cart:  { description: '...', annotations: { readOnlyHint: true }, execute: showCart },
  checkout:   { description: '...', when: () => cart.items.length > 0, execute: checkout },
  cancel:     { description: '...', when: () => order.status === 'pending', execute: cancel },
})
```

A tool that disappears tells the agent nothing about why. `when` can return a
reason instead of `false`: the tool stays listed and refuses every call with
that string, so the agent can explain the gap to the user and carry on with the
rest of the workflow.

```ts
export_report: {
  description: 'Export this report as a CSV.',
  when: () => plan.exports || 'Exports are not included in this workspace plan.',
  execute: exportReport,
}
```

Call `registry.revalidate()` after state changes. The framework adapters below
call it for you as their framework updates.

## Framework adapters

### React

```tsx
import { useTools } from 'webmcpable/react'

function Cart({ items }) {
  useTools({
    checkout: {
      description: 'Check out the current cart.',
      when: () => items.length > 0,
      execute: placeOrder,
    },
  })
  return <CartView items={items} />
}
```

`useTools` registers on mount, unregisters on unmount, and revalidates after
each render. It supports StrictMode.

### Vue

```ts
import { useTools } from 'webmcpable/vue'

useTools({
  checkout: {
    description: 'Check out the current cart.',
    when: () => cart.value.items.length > 0,
    execute: placeOrder,
  },
})
```

A `watchEffect` tracks the reactive state your `when` predicate reads, so the
tool list follows the UI without a manual `revalidate()`. Tools unregister when
the component's scope closes.

### Svelte

```ts
import { useTools } from 'webmcpable/svelte'

useTools({
  checkout: {
    description: 'Check out the current cart.',
    when: () => cart.items.length > 0,
    execute: placeOrder,
  },
})
```

Runs on `$effect`, which tracks the runes your `when` predicate reads. Call it
in a component, or inside `$effect.root` for app-level tools.

### Effect

```ts
import { effectTools } from 'webmcpable/effect'

const registry = yield* effectTools({
  checkout: {
    description: 'Check out the current cart.',
    when: () => Effect.map(SubscriptionRef.get(cart), (n) => n > 0),
    execute: ({ address }) => placeOrder(address),
  },
}, { watch: [cart] })

yield* registry.mount
```

`effectTools` accepts Effect handlers and preserves typed failures. A change to
a watched ref triggers revalidation. Closing the scope unregisters the tools.

## The same tools, on-device

Chrome ships a second model surface: the [Prompt API](https://developer.chrome.com/docs/ai/prompt-api),
Gemini Nano running in the page. Behind `chrome://flags#prompt-api-tool-use` it
takes tools — and the shape it takes them in is the one you have already
written.

```ts
import { localTools } from 'webmcpable/local'

const session = await LanguageModel.create({
  tools: localTools(defs),
})

await session.prompt('Add two coffees to my cart and check out.')
```

`defs` is the same object you pass to `tools()`. Declare an action once and it
is available in both directions: outward to a remote agent through
`document.modelContext`, and inward to a model with no network at all. `when`
gating, input validation and the `confirm` gate behave identically on both
paths — a tool the user cannot reach does not become reachable because the
model asking for it happens to live in the page.

Two differences from a registry. There is nothing to revalidate: a session
holds the tools it was created with, so build the array again per `create()`
(or per `clone()`) to pick up a change — a tool whose `when` turned false
meanwhile still refuses at call time, so a stale array cannot run something the
user can no longer do. And `exposedTo` and `annotations` are WebMCP's, so the
Prompt API ignores them, except `readOnlyHint`, which still decides whether
`confirm` asks.

Everything else in this README is measured against a real Chrome. This is not:
tool use is undocumented outside the
[explainer](https://github.com/webmachinelearning/prompt-api), and the
conformance lane cannot run it without a Canary and a model download. Treat the
shape as the explainer's until that changes.

## Test without a supporting browser

`webmcpable/testing` installs an in-memory `document.modelContext`, so your
application tests run in Node.

```ts
import { installTestModelContext } from 'webmcpable/testing'

const mc = installTestModelContext()
await registry.mount()

const [tool] = await document.modelContext.getTools()
await document.modelContext.executeTool(tool, '{"address":"12 High St"}')

expect(mc.calls).toEqual([
  { name: 'checkout', input: { address: '12 High St' }, result: 'Order placed' },
])
```

The harness reproduces Chrome's JSON-string arguments, result serialization,
error handling, registration validation, and lexicographical tool ordering.

### End-to-end, in Playwright

`webmcpable/testing` puts the fake in the *test* process, which is all a
component test needs. An end-to-end test has the opposite problem: the
application runs in a browser, and Playwright's bundled Chromium carries no
WebMCP at all. `webmcpable/testing/playwright` installs the same fake in the
page instead, so a suite that never sees a flagged Chrome can still call the
tools an agent would call.

```ts
import { expect, test } from 'webmcpable/testing/playwright'

test('an agent calling a tool moves what the user sees', async ({ modelContext, page }) => {
  await page.goto('/cart')

  const result = await modelContext.callTool('add_to_cart', { qty: 2, sku: 'espresso' })

  expect(JSON.parse(result)).toEqual({ sku: 'espresso', total: 2 })
  await expect(page.getByTestId('cart-count')).toHaveText('2')
})
```

The second assertion is the one that carries weight. A tool reporting success
over a cart that never changed has told the agent a lie, and only the UI check
catches it.

`modelContext` offers three things:

- `getTools()`, with `inputSchema` already parsed. The browser hands that back
  as a JSON string, and reaching for `.properties` on it is the most common way
  a WebMCP test passes for the wrong reason.
- `callTool(name, input)`, which serialises the input to the JSON string Chrome
  demands and looks the tool up the way an agent does.
- `calls()`, every invocation so far with its input, for asserting what the
  agent actually did rather than only what the page now shows.

For a suite that already has its own fixtures, `installTestModelContext(page)`
is the same thing without the `test` export. Call it before the first `goto` —
the fake goes in through `addInitScript`, so it has to be in place before the
page registers anything.

```ts
import { test as base } from '@playwright/test'
import { installTestModelContext } from 'webmcpable/testing/playwright'

export const test = base.extend({
  modelContext: async ({ page }, use) => {
    await use(await installTestModelContext(page))
  },
})
```

### Two lanes, because a transcription drifts

`webmcpable/testing` is a hand-written copy of what a browser did when someone
last looked. That is fast and runs anywhere, and it is only as true as its last
reading. So there is a second lane that reads the original again:

```bash
CHROME_BIN="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  pnpm --filter webmcpable test:conformance
```

It drives a real Chrome — 152 or newer, launched with the WebMCP flags —
against the built bundle, asserting the same things the in-memory harness
asserts. When it fails, the copy is wrong, not the browser. It regenerates
[`e2e/CHROME-CONFORMANCE.md`](./packages/webmcpable/e2e/CHROME-CONFORMANCE.md)
as it goes, so the measurements are output rather than prose someone remembered
to update.

A third lane drives the same build the way an agent does, over CDP rather than
from inside the page, because those are not the same code path —
[`e2e/cdp.conformance.ts`](./packages/webmcpable/e2e/cdp.conformance.ts). It is
what measured that Chrome calls `execute` with one argument, which is why
`webmcpable` supplies the second.

A fourth lane, [`e2e/bundled-chromium.fixture.ts`](./packages/webmcpable/e2e/bundled-chromium.fixture.ts),
runs `webmcpable/testing/playwright` in Playwright's own Chromium — the browser
with no WebMCP in it — because that is the browser the helper exists for. Its
first assertion is that Chromium still has no `document.modelContext`, so the
lane cannot start passing for the wrong reason.

Use the same split in your own app: unit tests against `webmcpable/testing` on
every commit, end-to-end tests against `webmcpable/testing/playwright`, and a
small conformance lane against real Chrome to catch the day the browser moves.

### Hand your tools to an eval

Both lanes above answer "does this tool work". Neither answers "will a model
pick it" — that needs a model, and
[`webmcp-evals`](https://github.com/GoogleChromeLabs/webmcp-tools/tree/main/webmcp-evals)
already does it. Its `local` mode reads your tool list from a JSON file, and
`toolSchemas()` writes that file from the registry you already have, so the
schemas the model is judged on cannot drift from the ones you ship:

```ts
import { installTestModelContext, toolSchemas } from 'webmcpable/testing'

installTestModelContext()
await registry.mount()
writeFileSync('schema.json', JSON.stringify(await toolSchemas(), null, 2))
```

```bash
npx webmcp-evals local -t schema.json -e evals.json
```

`JSON.stringify(await getTools())` cannot stand in for this — a `RegisteredTool`
carries its owner `Window` and throws on a circular structure.

`doctor` and the debug panel are the cheap version of the same question: a thin
description or an undescribed parameter is a tool a model will misfire on, and
neither costs an API key.

## What this protects, and what it cannot

An agent driving your site runs in the session the user is already signed into,
and the user's only checkpoint is a consent dialogue **the browser renders, not
your page**. A `RegisteredTool` carries no reference to the code behind it, so
nothing in the page can bind the name a user approved to the function that runs.
That gap belongs to the browser.

What this library does is keep an honest site's tools honest:

- A tool is refused at execution time when its `when` predicate no longer holds,
  not merely hidden from the next listing.
- A description or schema that changes is re-registered, so an agent never reads
  a descriptor the page has moved past.
- `{ titles: 'off' }` withholds `title` from the browser, so a consent dialogue
  cannot promote a friendlier label over the name that runs.
- `confirm` asks again on the execute path, bound to the resolved name and
  arguments. Read-only tools skip it. This is a second check, not a replacement
  for the browser dialogue.
- `doctor` fails the build on a description built by interpolation — the usual
  way user content becomes text an agent reads as instruction — and on an
  `exposedTo` origin the browser will refuse. It warns on a title that does not
  contain the tool name, a page-initiated `executeTool`, and a mutating tool
  with no `when`.
- Both `doctor` and the panel measure names, descriptions and results against
  the [character budgets the Chrome team
  recommends](https://developer.chrome.com/docs/ai/webmcp/secure-tools): 30 for
  a name, 500 for a description, 150 for a parameter description, 1.5K for a
  result. They are agent guardrails rather than browser limits, so they warn.
- The debug panel flags a description phrased as an order to the agent, a title
  that does not match the name, a tool redefined under a name the agent already
  had, and a journal of the resolved calls.

None of that stops prompt injection, and none of it helps against a site that
means you harm — such a site would not use this library. It makes accidental
versions of those problems loud in development instead of silent in production.
The three rules the browser dialogue still needs are in
[spike/HONEST-HANDSHAKE.md](spike/HONEST-HANDSHAKE.md).

## Inspect what an agent sees

```ts
import { mountDebugPanel } from 'webmcpable/debug'
mountDebugPanel()
```

The panel lists every registered tool next to the result string an agent
receives. It flags MCP envelopes, thin descriptions, undescribed parameters,
invalid names, descriptions phrased as instructions to the agent, a `title` that
does not match the name, and tools redefined under a name the agent already had.
It flags a document that is a child frame, whose tools a client may never be
advertised. It keeps a journal of resolved calls — name and arguments, not the
label. Copy its report as Markdown.

## Track the draft

```bash
npx webmcpable doctor        # scan for known browser and draft hazards
npx webmcpable spec-check    # report changes to the draft WebIDL
```

Treat `spec-check` as a drift alarm rather than a correctness oracle. `doctor`
reads your source for hazards Chrome hides at runtime: an invented
`destructiveHint` or an `outputSchema`, both discarded without an error; a
description built by interpolation; a tool that navigates away before its
result is delivered.

## API vocabulary

Set `annotations: { untrustedContentHint: true }` on a tool that returns user
content or anything fetched from elsewhere, and `readOnlyHint: true` on one that
changes nothing — the second also skips `confirm`.

`tools()` returns a **registry**. `mount` registers, `revalidate` re-evaluates
every `when`, `unmount` aborts. A **tool** is a name, a description, an optional
input schema, and an `execute` function. Set `exposedTo` when callers in other origins of
the current document tree need access — exact secure origins only, measured in
[`e2e/model-context.conformance.ts`](./packages/webmcpable/e2e/model-context.conformance.ts):
Chrome refuses plain `http:` and has no wildcard. Pass `{ titles: 'off' }` to withhold
`title` from the browser, and `confirm` (a function, or `true` for
`window.confirm`) to ask before a mutating tool runs.

`execute` receives `(input, { signal })`. That signal aborts when the tool is
unregistered, not when an agent cancels a call — see [the path an agent actually
takes](#the-path-an-agent-actually-takes).

`localTools()` takes the same definitions and returns a plain array for
`LanguageModel.create({ tools })` — no registry, no lifecycle.

`input` accepts Zod 4 and ArkType schemas and converts them to JSON Schema for
you. It also accepts raw JSON Schema, which `webmcpable` passes through without
runtime validation. Standard Schema validation alone cannot produce the JSON
Schema that WebMCP registration requires, so convert a Valibot schema with
`@valibot/to-json-schema` and pass the result as raw JSON Schema.

## Licence

MIT
