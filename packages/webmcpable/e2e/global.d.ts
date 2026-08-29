import type { tools, isSupported } from '../src/index'

declare global {
  interface Window {
    webmcpable: { isSupported: typeof isSupported; tools: typeof tools }
  }
}
