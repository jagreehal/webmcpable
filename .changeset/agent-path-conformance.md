---
'webmcpable': minor
---

`execute` now always receives its documented `(input, { signal })`. Chrome calls
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
