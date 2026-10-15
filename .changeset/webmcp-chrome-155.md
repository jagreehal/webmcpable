---
'webmcpable': minor
---

Support the WebMCP draft annotations and Chrome 155.

- `ToolDef.annotations` accepts `readOnlyHint`, `untrustedContentHint`, `consequentialHint` and `debugging`, exported as `ToolAnnotations`.
- A handler's `signal` aborts when a client cancels the call and when the tool unregisters.
- `webmcpable/testing` and `webmcpable/testing/playwright` match Chrome 155. `executeTool` takes an object, `getTools()` returns `inputSchema` as an object, and both pass through JSON the way Chrome does.
- `doctor` flags a JSON string passed to `executeTool` with the new `execute-tool-string` rule.
- `toolSchemas()` includes each tool's `annotations` for `webmcp-evals`.
- webmcp-types 0.1.10.
