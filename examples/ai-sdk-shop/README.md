# AI SDK shop

A seed shop you can use two ways: click the packets, or ask a chat assistant. The
model runs on your machine through Ollama, and the tools run in the open tab.

- `useTools()` from `webmcpable/react` registers five tools over one basket.
- The AI SDK lists those tools and calls them from the browser.
- `ai-sdk-ollama` runs the model. You need no API key.
- `ui-sdk-elements` supplies the theme, the approval dialog and the chat input.

## Run it

```bash
pnpm install && pnpm build          # from the repository root
cd examples/ai-sdk-shop
pnpm install
ollama pull qwen3.5:4b
pnpm dev
```

Turn on `chrome://flags/#enable-webmcp-testing`, relaunch Chrome, and open
http://127.0.0.1:5180. Set `OLLAMA_MODEL` to try another model that supports tools.

## Try

| Say | Watch |
| --- | --- |
| Place my order | The model finds the basket empty, or `when` gives `checkout`'s reason |
| Add two packets of peas | The packet count changes |
| Make that three | The model picks `set_quantity` or `add_to_basket` |
| Add 50 marigolds | The limit comes back as text the model can explain |
| Place my order | `confirm` opens the approval and the call waits for you |

A small model sometimes misreports what happened. The line under the packets is
the shop's own record, and the approval lists the real basket.

The till roll prints each call through `onCall`, with the text the model received.

## How a message travels

1. The page lists its tools and posts them with the messages to `/api/chat`.
2. The server turns the definitions into tools with `createMCPTools` and streams from Ollama.
3. The page runs each call through `document.modelContext` and posts the result back.

Chrome returns a string result bare, and the AI SDK expects JSON.
`src/model-context.ts` quotes the strings so refusals and errors reach the model.

The chat route answers requests from this machine only. Add authentication before
you deploy a version of it.

`pnpm test` checks the basket and the adapter. `pnpm typecheck` checks the rest.
