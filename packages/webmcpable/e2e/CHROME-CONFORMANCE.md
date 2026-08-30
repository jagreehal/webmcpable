# User Stories

| Key | Value |
| --- | --- |
| Date | 2026-08-30T08:46:01.282Z |
| Version | 0.2.0 |
| Git SHA | 4ecae21 |

## consent.conformance.ts

### ✅ titles: "off" keeps a friendlier label out of the browser descriptor

- **Given** a tool registered with a title that does not match its name
- **When** the registry is mounted with titles off
- **Then** the browser stores an empty title, so it cannot promote the label

### ✅ a raw JSON Schema still rejects a call missing a required property

- **Given** a tool typed with plain JSON Schema rather than a Standard Schema
- **When** the agent omits a required property
- **Then** the agent is told which property is missing
- **And** the handler never saw the call

### ✅ a description that changes is re-registered, so the agent never reads a stale one

- **Given** a tool whose description is built from application state
- **When** that state changes and the registry revalidates
- **Then** the browser hands the agent the new description

### ✅ a tool refuses to run once its `when` stops holding

- **Given** a checkout tool registered while the cart has items
- **When** the cart empties after the agent has already been offered the tool
- **Then** the call is refused in text the agent can read
- **And** the handler never ran

### ✅ confirm refuses a mutating call the user did not approve

- **Given** a checkout tool with a page-side confirm that says no
- **When** the agent invokes it
- **Then** the handler never ran
- **And** the agent is told the call was not confirmed

### ✅ a two-face tool is flagged as a label mismatch, and a poisoned description is flagged too

- **Given** a tool whose title, name, and description do not agree
- **Then** the debug findings name the two-face label, the hidden instruction, and the swap

## model-context.conformance.ts

### ✅ the navigator aliases are gone

- **Given** Chrome 152, where the draft moved to document.modelContext
- **Then** navigator.modelContext no longer aliases it
- **And** the undocumented navigator.modelContextTesting is also gone

### ✅ a handler result reaches the agent as a string

- **Given** tools registered through webmcpable, each returning a different shape
- **When** the agent executes each one
- **Then** a string passes through untouched
- **And** a plain object is serialised
- **And** an MCP envelope is NOT unwrapped — the agent gets the wrapper
- **And** undefined becomes an empty result, because webmcpable normalises it
- **And** a thrown message survives, because webmcpable returns it as text

### ✅ Chrome is new enough to carry the WebMCP implementation

- **Given** a Chrome launched with the WebMCP flags
- **Then** the major version is at least 152
- **And** document.modelContext is present

### ✅ executeTool takes a JSON string and rejects an object

- **Given** a registered tool with an input schema
- **When** the agent calls it both ways
- **Then** a JSON string works
- **And** the object form the draft specifies is rejected

### ✅ a RegisteredTool is shaped the way webmcpable assumes

- **Given** a tool registered with every annotation server-side MCP defines
- **Then** inputSchema comes back as a JSON string, not the object the draft types
- **And** only the two annotations the draft defines survive; the rest vanish silently
- **And** it carries a Window, so JSON.stringify throws
- **And** title defaults to an empty string
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