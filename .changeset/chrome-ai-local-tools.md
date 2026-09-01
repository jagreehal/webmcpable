---
'webmcpable': minor
---

Add `webmcpable/local`. `localTools()` turns the same tool definitions into the
array Chrome's on-device Prompt API takes at `LanguageModel.create({ tools })`,
so one declaration serves both a remote agent calling in through
`document.modelContext` and Gemini Nano running in the page. `when` gating,
input validation and the `confirm` gate behave identically on both paths.

The package now also ships `SKILL.md`, an agent skill for writing these tools.
