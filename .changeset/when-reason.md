---
'webmcpable': minor
---

`when` can return a reason string as well as a boolean. `false` still
unregisters the tool; a string keeps it registered and refuses every call with
that text, so an agent reads why a capability is unavailable instead of watching
it vanish from the list (webmachinelearning/webmcp#262).
