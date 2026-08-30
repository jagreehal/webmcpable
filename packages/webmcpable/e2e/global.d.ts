import type { analyzeChange, analyzeTool } from '../src/debug/index'
import type { tools, isSupported } from '../src/index'

declare global {
  interface Window {
    webmcpable: {
      analyzeChange: typeof analyzeChange
      analyzeTool: typeof analyzeTool
      isSupported: typeof isSupported
      tools: typeof tools
    }
  }
}
