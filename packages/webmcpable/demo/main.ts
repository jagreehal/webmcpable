import { initFull } from 'autotel-web/full'
import * as z from 'zod'

// Every tool registration and every agent invocation becomes a span, streamed
// to the local OTLP receiver (`npx autotel-devtools`). Spans carry what the
// agent actually received, not what the handler meant to return.
initFull({
  endpoint: 'http://localhost:4318',
  service: 'webmcpable-demo',
  // Only WebMCP spans. The page's own navigation, fetch and vitals traffic is
  // noise here, and tracing the exporter's own POST would feed back on itself.
  captureFetch: false,
  captureNavigation: false,
  captureXHR: false,
})
// autotel-webmcp is not published yet, so the demo runs without it and only
// loses the WebMCP spans. Swap this back to a static import once it ships.
await import('autotel-webmcp')
  .then(({ instrumentWebMCP }) =>
    instrumentWebMCP({
      // This local diagnostic demo intentionally shows payloads. Production
      // apps should keep the privacy-safe default unless their data policy
      // allows it.
      capturePayloads: true,
      // webmcpable returns readable error text because Chrome discards thrown
      // error messages. Preserve that UX while marking the span as failed.
      isErrorResult: (value) => typeof value === 'string' && value.startsWith('Error: '),
    }),
  )
  .catch(() => {})
import { mountDebugPanel } from '../src/debug/index'
import { tools } from '../src/tools'

const cart: Array<string> = []
const count = document.getElementById('count')!

const registry = tools({
  add_to_cart: {
    description: 'Add a product to the shopping cart by its identifier.',
    input: z.object({ id: z.string().describe('The product id') }),
    // Deliberately wrong: the MCP envelope every other library ships.
    handler: ({ id }) => {
      cart.push(id)
      count.textContent = `cart: ${cart.length}`
      void registry.revalidate()
      return { content: [{ text: `Added ${id}`, type: 'text' }] }
    },
  },

  clear_cart: {
    description: 'Clears',
    // Deliberately wrong: not in the draft, silently ignored by the browser.
    annotations: { destructiveHint: true } as never,
    handler: () => {
      cart.length = 0
      count.textContent = 'cart: 0'
      void registry.revalidate()
      // Deliberately wrong: the agent receives the literal text "undefined".
    },
  },

  search_products: {
    description: 'Search the product catalogue by keyword and return matching items.',
    handler: ({ q }) => `Found 3 products matching "${q}"`,
    input: z.object({ q: z.string().describe('Search keywords, e.g. "blue running shoes"') }),
  },

  // Probe: readOnlyHint IS in the draft. If the panel shows it and not
  // destructiveHint, Chrome strips unknown annotations at registration.
  // If it shows neither, getTools() simply does not expose annotations.
  checkout: {
    description: 'Check out the current cart and place the order.',
    handler: ({ address }) => `Order placed, shipping to ${address}`,
    input: z.object({ address: z.string().describe('Delivery address') }),
    when: () => cart.length > 0,
  },

  view_cart: {
    annotations: { readOnlyHint: true },
    description: 'List the items currently in the shopping cart.',
    handler: () => (cart.length ? `Cart: ${cart.join(', ')}` : 'Cart is empty'),
  },
})

document.getElementById('add')!.addEventListener('click', () => {
  cart.push('sku-1')
  count.textContent = `cart: ${cart.length}`
  void registry.revalidate()
})

await registry.mount()
mountDebugPanel()
