# User Stories

| Key | Value |
| --- | --- |
| Date | 2026-09-02T08:18:43.350Z |
| Version | 0.4.0 |
| Git SHA | 1924db0 |

## cdp.conformance.ts

### ✅ a cancelled invocation is invisible to the page

- **Given** a tool that never resolves and watches the signal it was handed
- **When** a client starts it and then cancels the invocation
- **Then** the client is told the invocation was cancelled
- **And** but the page was never told: the handler is still running, its signal unaborted

### ✅ Chrome itself passes a registered execute exactly one argument

- **Given** a tool registered with the raw browser API, counting its arguments
- **When** a client invokes it
- **Then** the handler saw one argument, so a documented (input, options) signature would break

### ✅ the browser calls execute with one argument, and webmcpable supplies the second

- **Given** a tool registered through webmcpable that records what it was called with
- **When** an out-of-process client invokes it over CDP
- **Then** the call succeeds
- **And** the handler received an options object carrying an AbortSignal

### ✅ a thrown error reaches the client as a completed call carrying the message

- **Given** a webmcpable tool that throws, and a raw one that throws
- **When** a client invokes both
- **Then** the raw tool fails, and the client is told so
- **And** webmcpable’s tool reports success carrying the message as its output
- **And** so a client reading status alone cannot see the failure — the trade for a readable message in the page

### ✅ a JSON result reaches the client structured, not as a string

- **Given** tools returning an object, a string, and nothing
- **When** a client invokes each one
- **Then** the object arrives as an object — Chrome parses the JSON webmcpable serialised
- **And** a plain string arrives as a string
- **And** an empty result becomes Chrome’s canned success text

### ✅ the signal a handler is given aborts when the tool is unregistered

- **Given** a long-running tool whose `when` stops holding while it runs
- **When** a client starts the call, and the page then revalidates the tool away
- **Then** the handler’s signal aborts, so it can stop work the user can no longer reach

### ✅ a same-origin child frame’s tools never reach the client

- **Given** a child frame, allowed tools, registering one shared name and one of its own
- **Then** the page’s own tool list holds all three registrations — none was refused
- **When** a client lists what the page advertises
- **And** only the main frame’s tool is advertised
- **And** the child’s uniquely named tool is absent, with no error anywhere
- **And** and the advertised record belongs to the main frame

## consent.conformance.ts

### ✅ a tool refuses to run once its `when` stops holding

- **Given** a checkout tool registered while the cart has items
- **When** the cart empties after the agent has already been offered the tool
- **Then** the call is refused in text the agent can read
- **And** the handler never ran

### ✅ a description that changes is re-registered, so the agent never reads a stale one

- **Given** a tool whose description is built from application state
- **When** that state changes and the registry revalidates
- **Then** the browser hands the agent the new description

### ✅ titles: "off" keeps a friendlier label out of the browser descriptor

- **Given** a tool registered with a title that does not match its name
- **When** the registry is mounted with titles off
- **Then** the browser stores an empty title, so it cannot promote the label

### ✅ a raw JSON Schema still rejects a call missing a required property

- **Given** a tool typed with plain JSON Schema rather than a Standard Schema
- **When** the agent omits a required property
- **Then** the agent is told which property is missing
- **And** the handler never saw the call

### ✅ confirm refuses a mutating call the user did not approve

- **Given** a checkout tool with a page-side confirm that says no
- **When** the agent invokes it
- **Then** the handler never ran
- **And** the agent is told the call was not confirmed

### ✅ a two-face tool is flagged as a label mismatch, and a poisoned description is flagged too

- **Given** a tool whose title, name, and description do not agree
- **Then** the debug findings name the two-face label, the hidden instruction, and the swap

## declarative.conformance.ts

### ✅ a <form toolname> is a tool like any other

- **Given** a form carrying toolname and tooldescription, and no script
- **When** the agent lists the tools
- **Then** the browser has registered it, indistinguishable from an imperative tool

### ✅ a declarative tool without toolautosubmit waits for the human

- **Given** a form with no toolautosubmit attribute
- **When** the agent executes it and waits three seconds
- **Then** nothing comes back: the call is parked until someone presses the button

### ✅ a form and a registered tool cannot share a name

- **Given** a page whose form already claims "book_table"
- **When** the page registers a tool of the same name through webmcpable
- **Then** the browser refuses it, and webmcpable says which name lost
- **And** the form keeps the name — the imperative tool is simply absent

## model-context.conformance.ts

### ✅ Chrome is new enough to carry the WebMCP implementation

- **Given** a Chrome launched with the WebMCP flags
- **Then** the major version is at least 152
- **And** document.modelContext is present

### ✅ a handler result reaches the agent as a string

- **Given** tools registered through webmcpable, each returning a different shape
- **When** the agent executes each one
- **Then** a string passes through untouched
- **And** a plain object is serialised
- **And** an MCP envelope is NOT unwrapped — the agent gets the wrapper
- **And** undefined becomes an empty result, because webmcpable normalises it
- **And** a thrown message survives, because webmcpable returns it as text

### ✅ executeTool takes a JSON string and rejects an object

- **Given** a registered tool with an input schema
- **When** the agent calls it both ways
- **Then** a JSON string works
- **And** the object form the draft specifies is rejected

### ✅ the navigator aliases are gone

- **Given** Chrome 152, where the draft moved to document.modelContext
- **Then** navigator.modelContext no longer aliases it
- **And** the undocumented navigator.modelContextTesting is also gone

### ✅ a RegisteredTool is shaped the way webmcpable assumes

- **Given** a tool registered with every annotation server-side MCP defines
- **Then** inputSchema comes back as a JSON string, not the object the draft types
- **And** only the two annotations the draft defines survive; the rest vanish silently
- **And** it carries a Window, so JSON.stringify throws
- **And** title defaults to an empty string
- **And** outputSchema is dropped without an error, the way invented annotations are
- **And** the key set matches the pinned WebIDL

### ✅ registration rejects the same things the fake rejects

- **Given** a series of invalid tool definitions
- **When** each is registered
- **Then** an invalid name is an InvalidStateError
- **And** an empty description and a duplicate name are too
- **And** a non-function execute is a TypeError — it is a required WebIDL member
- **And** an unserialisable schema is a TypeError
- **And** an untrustworthy exposedTo origin is a SecurityError

### ✅ getTools returns lexicographical order, not registration order

- **Given** three tools registered out of alphabetical order
- **When** the agent lists them
- **Then** they come back sorted by name

### ✅ a navigating tool keeps a synchronous result and loses an awaited one

- **Given** two tools that navigate away, one returning at once and one awaiting first
- **When** the agent calls the one that returns in the same turn
- **Then** the result was delivered before the unload
- **And** the same call awaits anything after navigating
- **And** nothing was recorded: the unload took the result with it

### ✅ exposedTo takes secure origins only, and has no wildcard

- **Given** the same tool offered to four different origin lists
- **When** each registration is attempted
- **Then** an https origin is accepted, and so is localhost
- **And** loopback is the whole 127.0.0.0/8 block, ::1, and any .localhost
- **And** a plain http origin is refused
- **And** there is no wildcard — "*" is refused the same way