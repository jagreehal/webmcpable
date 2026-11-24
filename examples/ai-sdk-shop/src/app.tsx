import 'ui-sdk-elements/dialog'
import 'ui-sdk-elements/input'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { MAX_PACKETS, pounds, seeds, summarise, type SeedId } from './basket.ts'
import { useAssistant } from './use-assistant.ts'
import { useShop, type Call } from './use-shop.ts'

const SUGGESTIONS = ['What does beetroot cost?', 'Add two packets of peas', 'Place my order']

const drawings: Record<SeedId, string> = {
  beetroot: 'M50 78c-19 0-27-14-27-24 0-12 12-18 27-18s27 6 27 18c0 10-8 24-27 24Zm0 0v16M50 36c-3-14-14-20-22-22 2 12 10 20 22 22Zm0 0c3-14 14-20 22-22-2 12-10 20-22 22Z',
  marigold: 'M50 22l7 12 13-5-1 14 14 4-9 10 9 10-14 4 1 14-13-5-7 12-7-12-13 5 1-14-14-4 9-10-9-10 14-4-1-14 13 5ZM50 49a9 9 0 1 1 0 18 9 9 0 0 1 0-18Z',
  peas: 'M14 68c8-30 40-44 72-38-4 32-32 54-72 38ZM30 61a7 7 0 1 0 14 0 7 7 0 1 0-14 0ZM45 54a7 7 0 1 0 14 0 7 7 0 1 0-14 0ZM60 45a7 7 0 1 0 14 0 7 7 0 1 0-14 0Z',
}

function Packet({ id, onChange, quantity }: { id: SeedId; onChange: (quantity: number) => void; quantity: number }) {
  const seed = seeds.find((candidate) => candidate.id === id)!
  return (
    <li className="packet" style={{ '--packet': seed.color } as React.CSSProperties}>
      <svg aria-hidden="true" viewBox="0 0 100 100">
        <path d={drawings[id]} fillRule="evenodd" />
      </svg>
      <div className="packet-label">
        <h3>{seed.name}</h3>
        <p>{seed.detail}</p>
        <div className="packet-foot">
          <strong>{pounds(seed.pence)}</strong>
          <div className="stepper">
            <button aria-label={`Remove one packet of ${seed.name}`} disabled={quantity === 0} onClick={() => onChange(quantity - 1)} type="button">−</button>
            <output aria-label={`Packets of ${seed.name}`}>{quantity}</output>
            <button aria-label={`Add one packet of ${seed.name}`} disabled={quantity === MAX_PACKETS} onClick={() => onChange(quantity + 1)} type="button">+</button>
          </div>
        </div>
      </div>
    </li>
  )
}

const pretty = (text: string) => {
  try {
    return JSON.stringify(JSON.parse(text), null, 1)
  } catch {
    return text
  }
}

function TillRoll({ calls }: { calls: Array<Call> }) {
  const end = useRef<HTMLLIElement>(null)
  useEffect(() => {
    void end.current?.scrollIntoView({ block: 'nearest' })
  }, [calls.length])
  return (
    <section aria-labelledby="roll-title" className="roll">
      <h2 id="roll-title">Till roll</h2>
      <p>Each call the assistant makes, and the exact text it gets back.</p>
      <ol>
        {calls.length === 0 && <li className="roll-empty">Ask the assistant for something and it prints here.</li>}
        {calls.map((call, index) => (
          <li key={index} ref={index === calls.length - 1 ? end : undefined}>
            <div className="roll-head">
              <span>{call.name}</span>
              <span>{Math.round(call.ms)} ms</span>
            </div>
            <code>{JSON.stringify(call.input)}</code>
            <details open={!call.result.startsWith('{')}>
              <summary>{call.result.startsWith('{') ? 'Basket returned' : 'Text returned'}</summary>
              <pre>{pretty(call.result)}</pre>
            </details>
          </li>
        ))}
      </ol>
    </section>
  )
}

export function App() {
  const shop = useShop()
  const chat = useAssistant()
  const [draft, setDraft] = useState('')
  const dialog = useRef<HTMLElement & { open: boolean }>(null)
  const thread = useRef<HTMLDivElement>(null)
  const { items, total } = summarise(shop.basket)
  const { approving, respond } = shop

  useEffect(() => {
    const element = dialog.current
    if (!element) {return}
    element.open = approving
    // Escape and a press outside close it, which counts as a no.
    const closed = (event: Event) => {
      if (!(event as CustomEvent<{ open: boolean }>).detail.open) {respond(false)}
    }
    element.addEventListener('openchange', closed)
    return () => element.removeEventListener('openchange', closed)
  }, [approving, respond])

  useEffect(() => {
    thread.current?.scrollTo({ top: thread.current.scrollHeight })
  }, [chat.messages])

  const ask = (text: string) => {
    if (!text.trim() || !chat.ready || chat.busy) {return}
    void chat.sendMessage({ text: text.trim() })
    setDraft('')
  }
  const submit = (event: FormEvent) => {
    event.preventDefault()
    ask(draft)
  }

  return (
    <main>
      <div className="shop">
        <header>
          <h1>Plot 14 Seeds</h1>
          <p>Fill the basket yourself, or ask the assistant. You share the same basket.</p>
        </header>
        <ul className="shelf">
          {seeds.map(({ id }) => (
            <Packet id={id} key={id} onChange={(quantity) => shop.setQuantity(id, quantity)} quantity={shop.basket[id]} />
          ))}
        </ul>
        <section aria-live="polite" className="basket">
          {shop.outcome && <p className="outcome">{shop.outcome}</p>}
          {items.length === 0 ? (
            !shop.outcome && <p>Your basket is empty. Add a packet to start.</p>
          ) : (
            <>
              <p>{items.map(({ name, quantity }) => `${quantity} × ${name}`).join(', ')}</p>
              <strong>{total}</strong>
              <button data-slot="button" data-variant="solid" onClick={shop.placeOrder} type="button">Place order</button>
            </>
          )}
        </section>
      </div>

      <section aria-labelledby="chat-title" className="chat">
        <h2 id="chat-title">Ask the assistant</h2>
        <div aria-live="polite" className="thread" ref={thread}>
          {chat.messages.length === 0 && (
            <div className="suggestions">
              {SUGGESTIONS.map((text) => (
                <button data-slot="button" disabled={!chat.ready} key={text} onClick={() => ask(text)} type="button">{text}</button>
              ))}
            </div>
          )}
          {chat.messages.map(({ id, parts, role }) =>
            parts.map((part, index) =>
              part.type === 'text' && part.text.trim() ? (
                <p className={role} key={`${id}-${index}`}>{part.text}</p>
              ) : null,
            ),
          )}
          {chat.busy && <p className="waiting">Working on it</p>}
          {(chat.setupError ?? chat.error) && (
            <p className="problem" role="alert">{chat.setupError ?? chat.error?.message}</p>
          )}
        </div>
        <form onSubmit={submit}>
          <ui-input>
            <input aria-label="Message" onChange={(event) => setDraft(event.target.value)} placeholder="Make that three" value={draft} />
          </ui-input>
          {chat.busy ? (
            <button data-slot="button" onClick={() => void chat.stop()} type="button">Stop</button>
          ) : (
            <button data-slot="button" data-variant="solid" disabled={!chat.ready || !draft.trim()} type="submit">Send</button>
          )}
        </form>
      </section>

      <TillRoll calls={shop.calls} />

      <ui-dialog ref={dialog}>
        <ui-dialog-backdrop hidden />
        <ui-dialog-content hidden>
          <ui-dialog-title>Place this order?</ui-dialog-title>
          <ui-dialog-description>The assistant asked to check out. It waits for your answer.</ui-dialog-description>
          <ul className="approval-lines">
            {items.map(({ id, name, price, quantity }) => (
              <li key={id}>{quantity} × {name} at {price}</li>
            ))}
          </ul>
          <p className="approval-total">{total}</p>
          <div className="approval-actions">
            {/* ui-dialog-close reports the close before the click, and that would count as a no. */}
            <button data-slot="button" onClick={() => respond(false)} type="button">Not yet</button>
            <button data-slot="button" data-variant="solid" onClick={() => respond(true)} type="button">Place order</button>
          </div>
        </ui-dialog-content>
      </ui-dialog>
    </main>
  )
}
