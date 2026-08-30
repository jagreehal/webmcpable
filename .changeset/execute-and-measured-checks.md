---
'webmcpable': minor
---

Rename `handler` to `execute` in tool definitions, matching the WebMCP browser
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
