---
'webmcpable': minor
---

Ship the `doctor` and `spec-check` CLI inside `webmcpable` as a `webmcpable`
binary, replacing the separate `webmcpable-cli` package.

The CLI dropped its `effect` and `@effect/platform-node` dependencies for Node
builtins, so `webmcpable` still installs with a single runtime dependency and
browser bundles are unaffected. `webmcpable-cli` was never published, so no
installs break.

Run `npx webmcpable doctor` where you would have run `npx webmcpable-cli doctor`.
