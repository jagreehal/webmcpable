/**
 * Gaps in webmcp-types@0.2.0.
 *
 * - `navigator.modelContextTesting` was undocumented and present in Chrome 151,
 *   and withdrawn in 152. Optional, so code must cope with its absence.
 * - `waitForToolsUntil` is in the draft and in Chrome 160.
 */
declare namespace WebMCP {
  interface ModelContext {
    waitForToolsUntil?(promise: Promise<unknown>): void
  }

  interface ModelContextTesting {
    executeTool(tool: { name: string }, inputArguments: string): Promise<string>
    listTools(): Array<{ description: string; inputSchema: string; name: string; }>
  }
}

interface Navigator {
  readonly modelContextTesting?: WebMCP.ModelContextTesting
}
