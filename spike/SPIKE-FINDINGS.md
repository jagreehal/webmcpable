# Spike findings

How Chrome's WebMCP implementation actually behaves, and where it parts company
with the W3C draft.

**Last measured: Chrome 152.** Every entry below is encoded somewhere in this
repository, and each one names that file so you can check it. Nothing here is
inferred from the draft.

These findings are no longer maintained by hand. `pnpm --filter webmcpable
test:conformance` re-runs every claim against a real Chrome and regenerates
[`packages/webmcpable/e2e/CHROME-CONFORMANCE.md`](../packages/webmcpable/e2e/CHROME-CONFORMANCE.md).
When a claim below disagrees with that file, that file is right.

## Re-running the measurements

```bash
CHROME_BIN="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  pnpm --filter webmcpable test:conformance
```

This drives a real Chrome with `--enable-experimental-web-platform-features`
and `--enable-features=WebMCPTesting,DevToolsWebMCPSupport`, exercising the
built bundle rather than the source. **Chrome 152 is the floor**: 149-151
exposed only the testing surface under headless.

`index.html` beside this file remains the exploratory harness for looking at
something new by hand — open it in a WebMCP-enabled browser and read the
output. The conformance lane is what keeps the claims below honest.

## 1. Return values

Chrome hands the agent a string. Anything a handler returns gets flattened into
one on the way out.

| A handler returns | The agent receives |
| --- | --- |
| `'Added'` | `Added` |
| `{ content: [{ type: 'text', text: 'Added' }] }` | `{"content":[{"type":"text","text":"Added"}]}`, the MCP wrapper, unparsed |
| `{ a: 1 }` | `{"a":1}` |
| `undefined` | `"undefined"`, the literal nine characters |
| `throw new Error('out of stock')` | `UnknownError: Tool was executed but the invocation failed` |

Two of these bite hard. Chrome never unwraps an MCP `content` envelope, so a
handler written against server-side MCP conventions delivers a wrapper the model
has to parse back out. And a thrown error loses its message, so the agent learns
that something failed but not what.

`src/result.ts` normalises all of it: strings pass through, `undefined` becomes
an empty result, other values serialise as JSON, and a thrown error returns as
`Error: <message>` so the message survives. `src/result.test.ts` pins each case.

Chrome renders the empty result as `"Operation succeeded"`.

## 2. Input arguments

The draft passes tool input as an object. Chrome requires a JSON string and
rejects the object form (measured in 151 and again in 152).

| Call | Result |
| --- | --- |
| `executeTool(tool, JSON.stringify({ q: 'x' }))` | resolves |
| `executeTool(tool, { q: 'x' })` | `UnknownError: Failed to parse input arguments` |

`src/webmcp.d.ts` types `executeTool` as it behaves rather than as the draft
specifies. The `execute-tool-object` rule in `src/cli/rules.ts` catches the
object form in source. `src/testing/index.ts` reproduces the rejection so tests
fail the same way the browser does.

`executeTool` ships in Chrome 151 and 152 and appears in the draft at `index.bs:607`,
but `webmcp-types@0.1.5` omits it. An upstream PR is pending.

## 3. inputSchema comes back as a string

The draft types `RegisteredTool.inputSchema` as an object (`index.bs:1207`) and
`webmcp-types` agrees. Chrome returns a JSON string (151 and 152).

Code reading `tool.inputSchema.properties` gets `undefined` with no error, which
is the worst shape a bug can take. Read it through `readInputSchema()` in
`src/schema.ts` instead.

## 4. Annotations outside the draft vanish

The draft defines two: `readOnlyHint` and `untrustedContentHint`.

Register a tool carrying `destructiveHint`, `idempotentHint`, `openWorldHint`,
`confirmationHint`, or `safetyLevel` and Chrome accepts the registration, drops
the annotation, and reports nothing. Those names come from server-side MCP and
have no counterpart here.

`ToolDef.annotations` in `src/tools.ts` admits only the two the draft defines.
The `unknown-annotation` rule in `src/cli/rules.ts` flags the rest in source,
since the browser will not.

## 5. A RegisteredTool holds a Window

Every `RegisteredTool` from `getTools()` carries a reference to its owner
`window`, which makes the object circular. `JSON.stringify(tools)` throws
`Converting circular structure to JSON`.

Pick fields explicitly, or go through `navigator.modelContextTesting.listTools()`.
The `stringify-registered-tool` rule in `src/cli/rules.ts` catches the common
version of this.

## 6. getTools returns lexicographical order

`getTools()` sorts by tool name rather than returning registration order, and
holds that order after a tool unregisters. The web platform test
`getTools.https.html` covers this. `src/testing/index.ts` sorts the same way so
a test asserting on tool order does not pass locally and fail in a browser.

## 7. Registration rejects these

Chrome validates at registration and throws:

| Cause | Error |
| --- | --- |
| Empty or non-string tool name | `InvalidStateError` |
| Empty or non-string description | `InvalidStateError` |
| `execute` is not a function | `TypeError` (a required WebIDL member, so it fails at the binding layer) |
| A tool of that name is already registered | `InvalidStateError` |
| `inputSchema` is not JSON-serializable | `TypeError` |
| An `exposedTo` origin is not trustworthy | `SecurityError` |

`src/testing/index.ts` reproduces each one.

## 8. Surface that is not in the draft

- **`navigator.modelContext`** aliased `document.modelContext` through Chrome
  151 and **is gone in 152** — the withdrawal this file warned about has
  happened. Code still reading it gets `undefined` with no error. The
  `navigator-alias` rule in `src/cli/rules.ts` flags it.
- **`unregisterTool()`** does not exist. Pass `{ signal }` to `registerTool` and
  abort the signal. The `no-unregister-tool` rule flags calls to it.
- **`navigator.modelContextTesting`** was present in Chrome 151, documented
  nowhere, and **is also gone in 152**. `getTools()` carries `inputSchema`, so
  nothing needs it; the debug panel keeps an optional read for older Chromes.
  `src/webmcp.d.ts` types the parts this project uses.

## Checking your own source

```bash
npx webmcpable doctor
```

`doctor` scans for the hazards above that a browser hides at runtime. `npx
webmcpable spec-check` compares the pinned WebIDL against the live draft and
exits non-zero when the draft moves.
