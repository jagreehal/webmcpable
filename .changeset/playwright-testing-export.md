---
'webmcpable': minor
---

`webmcpable/testing/playwright` is a new export: the same fake
`document.modelContext`, installed in the page rather than the test process, so
end-to-end tests can drive a page's tools in Playwright's bundled Chromium.

`installTestModelContext(page)` injects it through `addInitScript` and hands
back `getTools()` with `inputSchema` already parsed, `callTool(name, input)`
which serialises the input the way Chrome expects and resolves the tool the way
an agent does, and `calls()` for what the agent actually did. A ready-made
`test` is exported for suites without their own fixtures.

A new lane, `e2e/bundled-chromium.fixture.ts`, runs it against Playwright's own
Chromium in CI.
