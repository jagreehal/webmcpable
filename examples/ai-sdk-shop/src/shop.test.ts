import assert from 'node:assert/strict'
import { test } from 'node:test'
import { emptyBasket, setPackets, summarise } from './basket.ts'
import { forAiSdk, toJsonText } from './model-context.ts'

test('totals the basket and lists the whole catalogue', () => {
  const summary = summarise(setPackets(setPackets(emptyBasket, 'peas', 2), 'marigold', 1))
  assert.equal(summary.total, '£9.00')
  assert.deepEqual(summary.items.map(({ id, quantity }) => [id, quantity]), [['peas', 2], ['marigold', 1]])
  assert.equal(summary.catalogue.length, 3)
})

test('refuses a quantity outside the limit and leaves the basket alone', () => {
  for (const quantity of [-1, 21, 1.5, Number.NaN]) {
    assert.throws(() => setPackets(emptyBasket, 'peas', quantity), /0 to 20 packets/)
  }
  assert.equal(emptyBasket.peas, 0)
})

test('quotes bare text and leaves JSON alone', () => {
  assert.equal(toJsonText('Your basket is empty.'), '"Your basket is empty."')
  assert.equal(toJsonText(''), '""')
  for (const json of ['{"total":"£1"}', '"already quoted"', '36', 'null']) {assert.equal(toJsonText(json), json)}
})

test('passes the Tool through untouched', async () => {
  const tool = { description: 'd', name: 'a', origin: 'http://x', window: undefined }
  const seen: Array<unknown> = []
  const context = forAiSdk({
    executeTool: async (...args) => {
      seen.push(...args)
      return 'done'
    },
    getTools: async () => [tool],
  })
  assert.equal((await context.getTools())[0], tool)
  assert.equal(await context.executeTool(tool, { n: 1 }), '"done"')
  assert.deepEqual(seen, [tool, { n: 1 }])
})
