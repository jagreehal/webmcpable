# webmcpable

[![npm](https://img.shields.io/npm/v/webmcpable)](https://www.npmjs.com/package/webmcpable)
[![license](https://img.shields.io/npm/l/webmcpable)](#licence)

**Let AI agents use your web app.** Declare your app's actions as tools an agent
can call. They run in the page, on your existing application logic, in the
user's session.

```bash
npm install webmcpable
```

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
in-memory harness in [`webmcpable/testing`](#test-without-a-supporting-browser).

Two things this library leaves alone. It does not bridge desktop MCP clients to
your page, and it does not polyfill WebMCP. The browser owns declarative
`<form toolname>` support.

## Your first tool

```ts
import { tools } from 'webmcpable'
import * as z from 'zod'

const registry = tools({
  checkout: {
    description: 'Check out the current cart and place the order.',
    when: () => cart.items.length > 0,        // only offered when it is possible
    input: z.object({ address: z.string().describe('Delivery address') }),
    handler: ({ address }) => placeOrder(address),
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

## Tools that follow page state

A tool the agent cannot use is worse than no tool. `when:` decides whether to
offer each one, so an empty cart hides `checkout` instead of failing it.

```ts
tools({
  view_cart:  { description: '...', handler: showCart },
  checkout:   { description: '...', when: () => cart.items.length > 0, handler: checkout },
  cancel:     { description: '...', when: () => order.status === 'pending', handler: cancel },
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
  handler: exportReport,
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
      handler: placeOrder,
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
    handler: placeOrder,
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
    handler: placeOrder,
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
    handler: ({ address }) => placeOrder(address),
  },
}, { watch: [cart] })

yield* registry.mount
```

`effectTools` accepts Effect handlers and preserves typed failures. A change to
a watched ref triggers revalidation. Closing the scope unregisters the tools.

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

Use the same split in your own app: unit tests against `webmcpable/testing` on
every commit, a small conformance lane against real Chrome to catch the day the
browser moves.

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
- `doctor` fails the build on a description built by interpolation — the usual
  way user content becomes text an agent reads as instruction.
- The debug panel flags a description phrased as an order to the agent, and a
  tool redefined under a name the agent already had.

None of that stops prompt injection, and none of it helps against a site that
means you harm — such a site would not use this library. It makes accidental
versions of those problems loud in development instead of silent in production.

## Inspect what an agent sees

```ts
import { mountDebugPanel } from 'webmcpable/debug'
mountDebugPanel()
```

The panel lists every registered tool next to the result string an agent
receives. It flags MCP envelopes, thin descriptions, undescribed parameters,
invalid names, descriptions phrased as instructions to the agent, and tools
redefined under a name the agent already had. Copy its report as Markdown.

## Track the draft

```bash
npx webmcpable doctor        # scan for known browser and draft hazards
npx webmcpable spec-check    # report changes to the draft WebIDL
```

Treat `spec-check` as a drift alarm rather than a correctness oracle. `doctor`
reads your source for hazards Chrome hides at runtime, such as an invented
`destructiveHint` that Chrome discards without an error.

## API vocabulary

`tools()` returns a **registry**. `mount` registers, `revalidate` re-evaluates
every `when`, `unmount` aborts. A **tool** is a name, a description, an optional
input schema, and a handler. Set `exposedTo` when callers in other origins of
the current document tree need access.

`input` accepts Zod 4 and ArkType schemas and converts them to JSON Schema for
you. It also accepts raw JSON Schema, which `webmcpable` passes through without
runtime validation. Standard Schema validation alone cannot produce the JSON
Schema that WebMCP registration requires, so convert a Valibot schema with
`@valibot/to-json-schema` and pass the result as raw JSON Schema.

## Licence

MIT
