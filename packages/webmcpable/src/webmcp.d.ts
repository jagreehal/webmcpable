/**
 * Gaps in webmcp-types@0.1.10.
 *
 * - `navigator.modelContextTesting` was undocumented and present in Chrome 151,
 *   and withdrawn in 152. Optional, so code must cope with its absence.
 */
declare namespace WebMCP {
  interface ModelContextTesting {
    executeTool(tool: { name: string }, inputArguments: string): Promise<string>
    listTools(): Array<{ description: string; inputSchema: string; name: string; }>
  }
}

interface Navigator {
  readonly modelContextTesting?: WebMCP.ModelContextTesting
}
