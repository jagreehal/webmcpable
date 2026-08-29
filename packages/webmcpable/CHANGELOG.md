# webmcpable

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
