export const seeds = [
  { color: '#4c8c2b', detail: 'Sow from March. Crops in 12 weeks.', id: 'peas', name: 'Sugar snap peas', pence: 295 },
  { color: '#8e1f4f', detail: 'Sow from April. Roots by midsummer.', id: 'beetroot', name: 'Beetroot', pence: 240 },
  { color: '#e59a00', detail: 'Sow in May. Flowers until frost.', id: 'marigold', name: 'Marigold', pence: 310 },
] as const

export type SeedId = (typeof seeds)[number]['id']
export type Basket = Record<SeedId, number>

export const emptyBasket: Basket = { beetroot: 0, marigold: 0, peas: 0 }
export const MAX_PACKETS = 20

export const pounds = (pence: number) => `£${(pence / 100).toFixed(2)}`

/** Throws with a message meant for the agent: webmcpable hands it over as text. */
export function setPackets(basket: Basket, id: SeedId, quantity: number): Basket {
  if (!Number.isInteger(quantity) || quantity < 0 || quantity > MAX_PACKETS) {
    throw new Error(`An order holds 0 to ${MAX_PACKETS} packets of each seed, and that would make ${quantity}.`)
  }
  return { ...basket, [id]: quantity }
}

export function summarise(basket: Basket) {
  const lines = seeds.filter(({ id }) => basket[id] > 0)
  return {
    catalogue: seeds.map(({ id, name, pence }) => ({ id, name, price: pounds(pence) })),
    items: lines.map(({ id, name, pence }) => ({ id, name, price: pounds(pence), quantity: basket[id] })),
    total: pounds(lines.reduce((sum, { id, pence }) => sum + pence * basket[id], 0)),
  }
}
