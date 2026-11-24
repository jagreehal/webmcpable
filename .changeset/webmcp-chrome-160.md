---
'webmcpable': minor
---

Support the Chrome 160 `Tool` interface, output schemas and `waitForToolsUntil()`.

- `tools()`, `useTools()` and `effectTools()` accept `outputSchema` and pass it to the browser.
- `useTools()` in React honours `confirm` on a single tool, and `onCall`. `effectTools()` accepts `onCall`, and `confirm` and `exposedTo` on a single tool.
- The registry calls `waitForToolsUntil()` while it registers tools.
- `webmcpable/testing` returns `Tool` objects with `source` in place of `window`, plus `outputSchema` and the `debugging` annotation. Schemas and annotations a tool omits are null.
- `executeTool` in the fake takes the `Tool` that `getTools()` returned and runs that registration.
- `doctor` accepts `outputSchema`.
- webmcp-types 0.2.0.
