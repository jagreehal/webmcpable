---
name: webmcpable
description: Write WebMCP tools with webmcpable so an AI agent can drive a web app. Covers tool definitions, `when` gating, result shapes, framework adapters, the on-device Prompt API via `webmcpable/local`, and testing without a supporting browser. Use when adding, reviewing, or debugging `document.modelContext`, `tools()`, `useTools()`, `effectTools()`, `localTools()`, or anything WebMCP in a browser app — including what an agent sees over CDP (`agent-browser webmcp list|invoke`).
---

# webmcpable

Declare a web app's actions as tools an agent can call. They run in the page, on
the existing application logic, in the user's session — no keys, no scraping.

```bash
npm install webmcpable
```

## A tool

```ts
import { tools } from 'webmcpable'
import * as z from 'zod'

const registry = tools({
  checkout: {
    description: 'Check out the current cart and place the order.',
    when: () => cart.items.length > 0,
    input: z.object({ address: z.string().describe('Delivery address') }),
    execute: ({ address }) => placeOrder(address),
  },
})

await registry.mount()
```

`mount()` registers, `revalidate()` re-evaluates every `when`, `unmount()`
aborts. All three no-op when the browser has no `document.modelContext`, so this
is safe to ship to every browser.

`input` takes Zod 4, ArkType, or raw JSON Schema (passed through unvalidated).
Standard Schema alone cannot produce the JSON Schema registration needs — convert
Valibot with `@valibot/to-json-schema` and pass the result.

## What the browser does that you would not expect

Measured in Chrome 151/152. This is why the library exists; do not hand-roll
`registerTool`.

| You write | Chrome gives the agent |
| --- | --- |
| `{ content: [{ type: 'text', text: 'Added' }] }` | the MCP wrapper, unparsed, as a JSON string |
| `return undefined` | `"undefined"`, literally |
| `throw new Error('out of stock')` | `UnknownError: Tool was executed but the invocation failed` |
| `annotations: { destructiveHint: true }` | nothing — discarded at registration |
| `executeTool(tool, { q: 'x' })` | `UnknownError: Failed to parse input arguments` (args are a JSON **string**) |

`webmcpable` normalizes all of these: return a string, a JSON-compatible value,
or `undefined`, and throw normally — the agent reads `Error: out of stock`.

Only two annotations exist: `readOnlyHint` and `untrustedContentHint`. Set
`untrustedContentHint` on any tool returning user content or fetched data.

## What an agent sees, which is not what the page sees

An agent is not in the page. It drives Chrome's CDP `WebMCP` domain from
outside — `agent-browser webmcp list | invoke | result | cancel` is the
reference client. Measured in Chrome 152:

| In the page | What the client gets |
| --- | --- |
| `return { count: 3 }` | `output: { "count": 3 }`, structured — Chrome parses what webmcpable serialised |
| `return undefined` | `output: "Operation succeeded"` |
| `throw new Error('out of stock')` | `status: "Completed"`, `output: "Error: out of stock"` |
| a tool registered in a same-origin child frame | nothing — never advertised, no error |

The third row is deliberate: Chrome erases a thrown message in the page, so
webmcpable returns it as text. A client watching `status` alone will not see the
failure. Say what went wrong in the returned text.

**`execute`'s second argument.** Chrome calls a registered `execute` with one
argument. webmcpable supplies `{ signal }` itself so the documented signature
works — with raw `registerTool` your handler gets `undefined` and a destructure
throws.

**That signal is registration, not cancellation.** It aborts on `unmount()` or a
`revalidate()` where `when` stopped holding. When a client cancels an
invocation, Chrome tells the client `Canceled` and tells the page nothing: the
handler runs on, the promise never settles. Never leave a handler awaiting
something that may never arrive.

**Iframes.** A child frame needs `allow="tools"` to register at all, and a
same-origin child's tools still never reach a client attached to the top-level
page. Register from the top-level document.

**Client ceilings.** agent-browser caps input at 1 MB, output at 2 MB, and 512
tools, refusing rather than truncating.

## Rules to follow when writing tools

**Gate on what the user can actually do.** A tool the agent cannot use is worse
than no tool. `when` returning `false` unregisters it; returning a **string**
keeps it listed and refuses every call with that reason, so the agent can explain
the gap instead of watching a tool vanish.

```ts
export_report: {
  description: 'Export this report as a CSV.',
  when: () => plan.exports || 'Exports are not included in this workspace plan.',
  execute: exportReport,
}
```

**Return what changed, not that something changed.** `'Filters updated'` forces a
second call that races your render. Return the new state from the tool that made
it.

**Defer navigation.** A navigating tool unloads the document that still owes the
agent a result. Resolve first, navigate from a task:

```ts
execute: ({ id }) => {
  setTimeout(() => location.assign(`/product/${id}`), 0)
  return `Opening ${id}.`
}
```

**Never interpolate user or fetched content into a `description`.** That is how
page content becomes text the agent reads as instruction. `doctor` fails the
build on it.

## Framework adapters

`useTools(defs)` from `webmcpable/react`, `/vue`, or `/svelte` registers on
mount, unregisters on unmount, and revalidates as the framework updates — no
manual `revalidate()`. React supports StrictMode; Vue tracks via `watchEffect`;
Svelte runs on `$effect` (use `$effect.root` for app-level tools).

`effectTools(defs, { watch: [ref] })` from `webmcpable/effect` accepts Effect
handlers, preserves typed failures, and revalidates when a watched ref changes.

## The same tools, on-device

Chrome's Prompt API (Gemini Nano in the page, behind
`chrome://flags#prompt-api-tool-use`) takes tools in a shape `localTools()`
produces from the identical definitions:

```ts
import { localTools } from 'webmcpable/local'

const session = await LanguageModel.create({ tools: localTools(defs) })
await session.prompt('Add two coffees to my cart and check out.')
```

`when`, input validation and `confirm` behave the same on both paths. Two
differences: there is nothing to revalidate — a session holds the tools it was
created with, so rebuild the array per `create()`/`clone()` (a stale array still
refuses at call time, so it cannot run something the user can no longer do) — and
`exposedTo`/`annotations` are WebMCP's, so the Prompt API ignores them except
`readOnlyHint`, which still decides whether `confirm` asks.

Prompt API tool use is undocumented outside the explainer and is not covered by
the conformance lane. Treat the shape as provisional.

## Test without a browser

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

It reproduces Chrome's JSON-string arguments, one-argument `execute` calls,
serialization, error handling and lexicographical ordering. Back it with a
conformance lane against real Chrome (`pnpm --filter webmcpable test:conformance`
in this repo), including one case driven over CDP the way an agent drives it —
in-page and out-of-process are not the same code path.

`toolSchemas()` writes the registry's schemas to a file for
[`webmcp-evals`](https://github.com/GoogleChromeLabs/webmcp-tools/tree/main/webmcp-evals);
`JSON.stringify(await getTools())` cannot stand in — a `RegisteredTool` carries
its owner `Window` and throws on a circular structure.

## Prove it before shipping

Deterministic tests answer "does the tool work". They do not answer "will a
model pick it". For a workflow that matters, keep an artifact next to it:

```text
artifacts/<domain>/<task>/
  manifest.json     goal, required page state, expected calls, expected UI change, excluded secrets
  eval.json         cases for webmcp-evals
  eval-report.md    results, including one contaminated-description case
```

Compare at least one task against plain accessibility-tree automation and record
success, tool calls, latency and tokens — that comparison is the reason to ship
tools at all. If no model runtime is available, record what was missing and mark
the comparison blocked rather than claiming it passed.

## Check it

```bash
npx webmcpable doctor        # browser and draft hazards in your source
npx webmcpable spec-check    # drift alarm against the live draft WebIDL
```

`mountDebugPanel()` from `webmcpable/debug` shows each tool next to the result
string an agent actually receives, flags MCP envelopes, thin descriptions,
descriptions phrased as orders, and a document that is a child frame, and
journals resolved calls.

## Security boundary

The user's only checkpoint is the browser's consent dialogue, which the page
cannot influence — a `RegisteredTool` carries no reference to the code behind it.
`webmcpable` keeps an honest site honest: refusal at execution time when `when`
stops holding, re-registration when a descriptor changes, `{ titles: 'off' }` to
withhold a friendlier label, and `confirm` as a second check bound to the
resolved name and arguments. None of it stops prompt injection.
