import type { analyzeChange, analyzeTool } from '../src/debug/index'
import type { tools, isSupported, Registry } from '../src/index'

declare global {
  interface Window {
    // Scratch state the CDP lane reads back out of the page.
    __aborted: boolean
    __argc: number
    __eligible: boolean
    __registry: Registry
    __seen: { signalIsAbortSignal?: boolean }
    webmcpable: {
      analyzeChange: typeof analyzeChange
      analyzeTool: typeof analyzeTool
      isSupported: typeof isSupported
      tools: typeof tools
    }
  }
}
