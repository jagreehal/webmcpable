---
'webmcpable': minor
---

Log what an agent did, and gate a single tool.

`tools(defs, { onCall })` reports every resolved call as `{ name, input, result, ms }`,
on both the WebMCP and on-device paths. `result` is exactly the string the agent
received, so refusals and thrown handlers arrive alongside successes, and a throw
from the sink leaves the call untouched.

`confirm` now also goes on a `ToolDef`, so the question lands on the one action that
warrants it. A tool's own setting wins over the registry's and over `readOnlyHint`.
