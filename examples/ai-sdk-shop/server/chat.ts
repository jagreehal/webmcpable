import type { IncomingMessage, ServerResponse } from 'node:http'
import { createMCPTools, MCPClientError } from '@ai-sdk/mcp'
import {
  convertToModelMessages,
  pipeUIMessageStreamToResponse,
  safeValidateUIMessages,
  streamText,
  toUIMessageStream,
} from 'ai'
import { ollama } from 'ai-sdk-ollama'

const MODEL = process.env['OLLAMA_MODEL'] ?? 'qwen3.5:4b'
const MAX_BODY = 1_000_000
const LOCAL_HOST = /^(?:127\.0\.0\.1|localhost):\d+$/

/** Host and Origin both have to be this machine, so another site cannot drive the model. */
function isLocal({ headers }: IncomingMessage): boolean {
  if (!LOCAL_HOST.test(headers.host ?? '')) {return false}
  return headers.origin === undefined || headers.origin === `http://${headers.host}`
}

async function readJson(request: IncomingMessage): Promise<{ messages?: unknown; tools?: unknown } | undefined> {
  let body = ''
  for await (const chunk of request.setEncoding('utf8')) {
    body += chunk
    if (body.length > MAX_BODY) {return undefined}
  }
  try {
    const parsed: unknown = JSON.parse(body)
    return typeof parsed === 'object' && parsed !== null ? parsed : undefined
  } catch {
    return undefined
  }
}

export async function handleChat(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const reject = (status: number, message: string) => {
    response.writeHead(status, { 'content-type': 'text/plain' }).end(message)
  }
  try {
    if (!isLocal(request)) {return reject(403, 'This endpoint only answers requests from this machine.')}
    if (request.method !== 'POST') {return reject(405, 'Use POST.')}

    const body = await readJson(request)
    if (!body || !Array.isArray(body.tools) || body.tools.length > 32) {
      return reject(400, 'Expected { messages, tools }.')
    }

    // These have no execute function: the page runs them and sends results back.
    const tools = createMCPTools(body.tools)
    const validated = await safeValidateUIMessages({ messages: body.messages, tools })
    if (!validated.success) {return reject(400, 'Those messages are not valid.')}
    const plain = validated.data.every(
      ({ parts, role }) =>
        (role === 'user' || role === 'assistant') &&
        parts.every(({ type }) => ['dynamic-tool', 'reasoning', 'step-start', 'text'].includes(type)),
    )
    if (!plain) {return reject(400, 'Only text and tool results are supported.')}

    const abort = new AbortController()
    response.on('close', () => abort.abort())
    const result = streamText({
      abortSignal: abort.signal,
      instructions:
        'You help in a seed shop. Use the tools for anything about products, prices or the basket. ' +
        'Change the basket only when asked. Call checkout only when the customer asks to place the order. ' +
        'If a tool refuses or fails, tell the customer the reason it gave. ' +
        'An order exists only when checkout returns the status "Order placed". If checkout was not confirmed, the ' +
        'customer declined it: say no order was placed. Keep replies to one or two sentences.',
      // A small model can run on, and a shop assistant should answer the same way twice.
      maxOutputTokens: 400,
      messages: await convertToModelMessages(validated.data, { tools }),
      model: ollama(MODEL, { think: false }),
      temperature: 0,
      tools,
    })
    await pipeUIMessageStreamToResponse({
      response,
      stream: toUIMessageStream({
        onError: (error) =>
          `${error instanceof Error ? error.message : String(error)} (is Ollama running, with ${MODEL} pulled?)`,
        stream: result.stream,
      }),
    })
  } catch (error) {
    if (response.headersSent) {response.end()}
    else if (MCPClientError.isInstance(error)) {reject(400, 'Those tool definitions are not valid.')}
    else {
      console.error(error)
      reject(500, 'The chat request failed. The terminal has the details.')
    }
  }
}
