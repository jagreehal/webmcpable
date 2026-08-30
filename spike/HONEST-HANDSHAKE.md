# Honest handshake

A short proposal for the browser consent dialogue. The page cannot implement
these rules: a `RegisteredTool` has no pointer to `execute`, and `toolchange`
does not say what moved. That gap belongs to WebMCP. This note is the ask.

`webmcpable` keeps an honest site's tools honest — execution-time `when`,
descriptor re-registration, `titles: 'off'`, an optional page-side confirm.
None of that is a substitute for the dialogue the user actually sees.

## Three rules

The login is the session. The only checkpoint between a helpful purchase and a
hostile one is the moment the user says yes. That yes has to be bound to the
call that runs.

1. **Bind consent to what runs, not to what is described.** Show the tool name
   that will execute and the arguments it carries. `title` is a subtitle, never
   the headline. Spec section 6.3.2 already admits there is no guarantee a
   tool's declared intent matches its behaviour; the dialogue should not pretend
   otherwise.

2. **Fingerprint every tool when the page loads, and flag the moment it
   changes.** Same name, different tool, is a warning — not a silent success.
   Fingerprint the implementation, not only the descriptor. A `toolchange` event
   that does not say what moved cannot tell a swap from an ordinary update.

3. **Make consent non-transitive.** Approving one call is never approval of the
   next. A hidden chain must not ride on an honest yes.

None of this ends prompt injection. What it does is make the human's yes an
honest one.

## What a `RegisteredTool` would need

- A stable identity for the function that will run, visible to the user at
  consent time and after a swap.
- The resolved name and arguments in the dialogue, with `title` demoted.
- One approval, one call. A second invocation is a second question.
