import {
  createMCPClient,
  Experimental_WebMCPTransport as WebMCPTransport,
  type Experimental_WebMCPModelContext as ModelContext,
  type MCPClient,
} from '@ai-sdk/mcp'
import { useChat } from '@ai-sdk/react'
import { DefaultChatTransport, lastAssistantMessageIsCompleteWithToolCalls } from 'ai'
import { useEffect, useRef, useState } from 'react'
import { forAiSdk } from './model-context.ts'

/** A small model can loop on its own tool calls, so a turn stops here. */
const MAX_STEPS = 8

const SETUP = 'Turn on chrome://flags/#enable-webmcp-testing, relaunch Chrome, and reload this page.'

export function useAssistant() {
  const client = useRef<MCPClient | undefined>(undefined)
  const [ready, setReady] = useState(false)
  const [setupError, setSetupError] = useState(() => (document.modelContext?.getTools ? undefined : SETUP))

  useEffect(() => {
    if (!document.modelContext?.getTools) {return}
    // The AI SDK types still ask for `window`; it only passes the tool back.
    const modelContext = forAiSdk(document.modelContext as unknown as ModelContext)
    let closed = false
    let connected: MCPClient | undefined
    createMCPClient({ transport: new WebMCPTransport({ modelContext }) }).then(
      (created) => {
        if (closed) {return void created.close()}
        connected = created
        client.current = created
        setReady(true)
      },
      (error: unknown) => setSetupError(String(error)),
    )
    return () => {
      closed = true
      client.current = undefined
      setReady(false)
      void connected?.close()
    }
  }, [])

  const { addToolOutput, error, messages, sendMessage, status, stop } = useChat({
    async onToolCall({ toolCall }) {
      if (!toolCall.dynamic) {return}
      const { input, toolCallId, toolName: tool } = toolCall
      // addToolOutput is not awaited: it waits for this callback to finish.
      try {
        if (!client.current) {throw new Error('The shop is not connected.')}
        const output = await client.current.callTool({ arguments: input as Record<string, unknown>, name: tool })
        void addToolOutput({ output, tool, toolCallId })
      } catch (error_) {
        const errorText = error_ instanceof Error ? error_.message : String(error_)
        void addToolOutput({ errorText, state: 'output-error', tool, toolCallId })
      }
    },
    sendAutomaticallyWhen: ({ messages: all }) =>
      lastAssistantMessageIsCompleteWithToolCalls({ messages: all }) &&
      (all.at(-1)?.parts.filter(({ type }) => type === 'step-start').length ?? 0) < MAX_STEPS,
    // oxlint-disable-next-line refs -- read when a message is sent, after render
    transport: new DefaultChatTransport({
      api: '/api/chat',
      async prepareSendMessagesRequest({ messages: all }) {
        if (!client.current) {throw new Error('The shop is not connected.')}
        // Listed per request, so the model gets the tools as they are now.
        const { tools } = await client.current.listTools()
        return { body: { messages: all, tools } }
      },
    }),
  })

  return { busy: status === 'submitted' || status === 'streaming', error, messages, ready, sendMessage, setupError, stop }
}
