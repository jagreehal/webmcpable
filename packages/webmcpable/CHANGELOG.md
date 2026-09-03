# webmcpable

## 0.5.0

### Minor Changes

- 6742d3a: `execute` now always receives its documented `(input, { signal })`. Chrome calls
  a registered `execute` with one argument, so `webmcpable` supplies the options
  object itself, and `installTestModelContext()` calls `execute` the same way
  Chrome does. The signal follows the tool's registration: it aborts on
  `unmount()`, or on a `revalidate()` where `when` stopped holding.
  
  A new conformance lane, `e2e/cdp.conformance.ts`, drives the built bundle over
  Chrome's CDP `WebMCP` domain the way a client such as
  [agent-browser](https://github.com/vercel-labs/agent-browser) does. Its
  measurements are now in the README: a JSON result reaches a client structured, a
  thrown message reaches it as a completed call carrying the text, and a cancelled
  invocation leaves the page's handler running.
  
  `analyzeContext()` is a new export from `webmcpable/debug`, and the panel flags a
  document that is a child frame, whose tools reach the page's own `getTools()` and
  are not advertised to a client.
- f597f4f: `webmcpable/testing/playwright` is a new export: the same fake
  `document.modelContext`, installed in the page rather than the test process, so
  end-to-end tests can drive a page's tools in Playwright's bundled Chromium.
  
  `installTestModelContext(page)` injects it through `addInitScript` and hands
  back `getTools()` with `inputSchema` already parsed, `callTool(name, input)`
  which serialises the input the way Chrome expects and resolves the tool the way
  an agent does, and `calls()` for what the agent actually did. A ready-made
  `test` is exported for suites without their own fixtures.
  
  A new lane, `e2e/bundled-chromium.fixture.ts`, runs it against Playwright's own
  Chromium in CI.

## 0.4.0

### Minor Changes

- 5abc534: Add `webmcpable/local`. `localTools()` turns the same tool definitions into the
  array Chrome's on-device Prompt API takes at `LanguageModel.create({ tools })`,
  so one declaration serves both a remote agent calling in through
  `document.modelContext` and Gemini Nano running in the page. `when` gating,
  input validation and the `confirm` gate behave identically on both paths.
  
  The package now also ships `SKILL.md`, an agent skill for writing these tools.

## 0.3.0

### Minor Changes

- 75c5305: Rename `handler` to `execute` in tool definitions, matching the WebMCP browser
  API, Angular's `declareExperimentalWebMcpTool`, and every published demo. This
  is a breaking change: rename the property in your `tools()`, `useTools()` and
  `effectTools()` definitions.
  
  Bind the page-side consent path to the call that runs. `{ titles: 'off' }`
  withholds `title` from the browser so a consent dialogue cannot promote a
  friendlier label over the name that runs, `confirm` asks before a mutating tool
  executes and tells the user when the descriptor has moved since page load, and
  two-face labels, chained `executeTool` and tools with no `when` are loud in
  `doctor` and the debug panel.
  
  New:
  
  - `webmcpable/declarative` ships the `<form toolname>` attribute types for JSX,
    for pages that mix declarative forms with `tools()`.
  - `toolSchemas()` in `webmcpable/testing` exports the registered tools in the
    shape `webmcp-evals local -t` reads, so an eval suite scores the schemas you
    actually ship rather than a JSON file that drifts from them.
  - A failed registration names the tool. Chrome refuses a duplicate with
    `InvalidStateError: Duplicate tool name` and never says which name lost — and
    a `<form toolname>` is a claimant too.
  - `doctor` flags `outputSchema` (not in the draft, dropped at registration), a
    tool that navigates before its result is delivered, and an `exposedTo` origin
    the browser will refuse. It reads the shapes tools are really written in:
    passed to `registerTool`, assigned to a variable, keyed by a quoted or numeric
    name, or with `execute` as a method.
  - `doctor` and the debug panel check the Chrome team's character budgets: 30 for
    a name, 500 for a description, 150 for a parameter description, 1.5K for a
    result.
  
  Every one of those checks is measured against Chrome 152 in the conformance
  lane rather than reasoned about — `outputSchema` is dropped at registration, a
  form and a registered tool cannot share a name, a declarative tool with no
  `toolautosubmit` parks the call until a human submits, a navigating tool keeps a
  synchronous result and loses an awaited one, and `exposedTo` takes secure
  origins only, with no wildcard and with the whole loopback range.
  
  Fixes:
  
  - `tools()` unregisters a tool that leaves the definitions, so an adapter can
    hand over a changing set without the departed one staying callable.
  - `revalidate()` re-registers when a tool's description or schema changes, and
    the registry keeps its record of the descriptor the user first consented to
    across that change.

## 0.2.0

### Minor Changes

- f5ed130: Harden the consent path, and measure it against a real browser.
  
  - `when` is now checked at execution time, not only at registration. A tool
    whose predicate has stopped holding refuses the call instead of running it.
    This is a behaviour change: a call landing in the window between revalidations
    now returns `"<name> is not available right now."`.
  - `sync()` reconciles on the tool descriptor rather than the name, so a
    description, schema or annotation built from application state is
    re-registered when it changes. Previously Vue and Svelte apps kept their
    mount-time descriptions forever.
  - Raw JSON Schema inputs are checked against their top-level `required` list.
    They previously reached the handler with no validation at all.
  - `doctor` gains `dynamic-description`, which fails on a description built by
    interpolation — the usual route for user content to become text an agent
    reads as instruction.
  - The debug panel flags descriptions phrased as instructions to the agent
    (`instruction-in-description`) and tools redefined under a name the agent
    already had (`tool-redefined`).
  - Framework adapters report registration failures again. A lint autofix had
    emptied the handler, so they were failing silently.
  - New conformance lane (`pnpm --filter webmcpable test:conformance`) drives a
    real Chrome 152+ with the WebMCP flags. It found that `navigator.modelContext`
    and `navigator.modelContextTesting` are gone in 152, and that a non-function
    `execute` rejects with `TypeError` rather than `InvalidStateError` — the test
    harness has been corrected to match.
- f5ed130: Ship the `doctor` and `spec-check` CLI inside `webmcpable` as a `webmcpable`
  binary, replacing the separate `webmcpable-cli` package.
  
  The CLI dropped its `effect` and `@effect/platform-node` dependencies for Node
  builtins, so `webmcpable` still installs with a single runtime dependency and
  browser bundles are unaffected. `webmcpable-cli` was never published, so no
  installs break.
  
  Run `npx webmcpable doctor` where you would have run `npx webmcpable-cli doctor`.
- f5ed130: `when` can return a reason string as well as a boolean. `false` still
  unregisters the tool; a string keeps it registered and refuses every call with
  that text, so an agent reads why a capability is unavailable instead of watching
  it vanish from the list (webmachinelearning/webmcp#262).
