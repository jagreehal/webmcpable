---
'webmcpable': minor
---

Support the `consequentialHint` and `debugging` annotations from the WebMCP draft, and Chrome 154's per-call signal.

- `ToolDef.annotations` accepts all four draft annotations, exported as `ToolAnnotations`. `doctor` and `analyzeTool` accept them too.
- In Chrome 154, a handler's `signal` aborts when a client cancels the call as well as when the tool is unregistered.
- `webmcpable/testing` and `webmcpable/testing/playwright` match Chrome 154: `execute` receives `(input, { signal })`, `getTools()` returns `consequentialHint`, and `executeTool` honours a caller's `signal`.
