/**
 * Gaps in webmcp-types@0.1.5, and Chrome's divergences from it.
 *
 * - `executeTool` is in the W3C draft (index.bs:607) and ships in Chrome 151+,
 *   but is missing from the official types. Upstream PR pending.
 * - Chrome requires input as a JSON *string*, not the object the draft
 *   specifies. Typed here as it actually behaves. See spike/SPIKE-FINDINGS.md.
 * - `navigator.modelContextTesting` was undocumented and present in Chrome 151,
 *   and withdrawn in 152. Optional, so code must cope with its absence.
 */
declare namespace WebMCP {
  interface ModelContext {
    executeTool(
      tool: RegisteredTool,
      inputArguments: string,
      options?: { signal?: AbortSignal },
    ): Promise<string>
  }

  interface ModelContextTesting {
    executeTool(tool: { name: string }, inputArguments: string): Promise<string>
    listTools(): Array<{ description: string; inputSchema: string; name: string; }>
  }
}

interface Navigator {
  readonly modelContextTesting?: WebMCP.ModelContextTesting
}
