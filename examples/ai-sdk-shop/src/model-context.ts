import type { Experimental_WebMCPModelContext as ModelContext } from '@ai-sdk/mcp'

/**
 * Chrome returns a string result bare. The AI SDK transport expects JSON, as the
 * draft does, so quote what does not parse and leave the rest alone.
 */
export function toJsonText(text: string): string {
  try {
    JSON.parse(text)
    return text
  } catch {
    return JSON.stringify(text)
  }
}

export const forAiSdk = (context: ModelContext): ModelContext => ({
  executeTool: async (...args) => toJsonText(await context.executeTool(...args)),
  getTools: (options) => context.getTools(options),
})
