import { useCallback, useRef, useState } from 'react'
import type { RegistryOptions } from 'webmcpable'
import { useTools } from 'webmcpable/react'
import * as z from 'zod'
import { emptyBasket, setPackets, summarise, type Basket, type SeedId } from './basket.ts'

export type Call = Parameters<NonNullable<RegistryOptions['onCall']>>[0]

const seed = z.enum(['peas', 'beetroot', 'marigold'])
const line = z.object({ id: seed, name: z.string(), price: z.string() })
const summary = z.object({
  catalogue: z.array(line),
  items: z.array(line.extend({ quantity: z.number() })),
  total: z.string(),
})

/** The basket, the five tools over it, and the approval a checkout waits for. */
export function useShop() {
  const [basket, setBasket] = useState(emptyBasket)
  const [calls, setCalls] = useState<Array<Call>>([])
  // What happened at the till, in the shop's words rather than the model's.
  const [outcome, setOutcome] = useState<string>()
  const [approving, setApproving] = useState(false)
  // Tool calls can arrive faster than React renders, so they read this.
  const latest = useRef(basket)
  const answer = useRef<((approved: boolean) => void) | undefined>(undefined)

  const write = useCallback((next: Basket) => {
    latest.current = next
    setBasket(next)
    setOutcome(undefined)
    return summarise(next)
  }, [])

  const setQuantity = useCallback(
    (id: SeedId, quantity: number) => write(setPackets(latest.current, id, quantity)),
    [write],
  )

  const placeOrder = useCallback(() => {
    const { items, total } = summarise(latest.current)
    write(emptyBasket)
    setOutcome(`Order placed for ${total}. Happy sowing.`)
    return { items, status: 'Order placed', total }
  }, [write])

  const respond = useCallback((approved: boolean) => {
    if (!answer.current) {return}
    answer.current(approved)
    answer.current = undefined
    setApproving(false)
    if (!approved) {setOutcome('You declined, so no order was placed.')}
  }, [])

  useTools(
    {
      add_to_basket: {
        description: 'Add packets of one seed to the basket, on top of any already there.',
        execute: ({ id, quantity }) => setQuantity(id, latest.current[id] + quantity),
        input: z.object({ id: seed, quantity: z.number().int().min(1) }),
        outputSchema: summary,
      },
      checkout: {
        annotations: { consequentialHint: true },
        confirm: () => {
          if (answer.current) {return false}
          setOutcome(undefined)
          setApproving(true)
          return new Promise<boolean>((resolve) => {
            answer.current = resolve
          })
        },
        description: 'Place the order for everything in the basket. The customer approves it on screen first.',
        execute: placeOrder,
        when: () => summarise(latest.current).items.length > 0 || 'The basket is empty, so there is no order to place.',
      },
      read_basket: {
        annotations: { readOnlyHint: true },
        description: 'Read the basket, its total, and the catalogue with prices.',
        execute: () => summarise(latest.current),
        outputSchema: summary,
      },
      remove_from_basket: {
        description: 'Remove every packet of one seed from the basket.',
        execute: ({ id }) => setQuantity(id, 0),
        input: z.object({ id: seed }),
        outputSchema: summary,
      },
      set_quantity: {
        description: 'Set the exact number of packets of one seed. Zero removes it.',
        execute: ({ id, quantity }) => setQuantity(id, quantity),
        input: z.object({ id: seed, quantity: z.number().int().min(0) }),
        outputSchema: summary,
      },
    },
    { onCall: (call) => setCalls((before) => [...before, call]) },
  )

  return { approving, basket, calls, outcome, placeOrder, respond, setQuantity }
}
