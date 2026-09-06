import * as z from 'zod'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { modelContext } from './model-context'
import { installTestModelContext } from './testing/index'
import { localTools } from './local'
import { tools } from './tools'

/**
 * `onCall` is the record of what an agent did: one event per resolved call,
 * carrying exactly what the agent sent and exactly what it got back.
 */
describe('what the agent actually did', () => {
  beforeEach(() => {
    installTestModelContext()
  })

  it('reports the name, the arguments the agent sent, and the result it got', async () => {
    const onCall = vi.fn()
    const registry = tools(
      {
        add_to_cart: {
          description: 'Add an item to the cart',
          execute: ({ sku }) => ({ added: sku }),
          input: z.object({ sku: z.string() }),
        },
      },
      { onCall },
    )
    await registry.mount()
    const [tool] = await modelContext().getTools()

    await modelContext().executeTool(tool!, '{"sku":"espresso"}')

    expect(onCall).toHaveBeenCalledTimes(1)
    expect(onCall.mock.calls[0]![0]).toMatchObject({
      input: { sku: 'espresso' },
      name: 'add_to_cart',
      result: '{"added":"espresso"}',
    })
    expect(onCall.mock.calls[0]![0].ms).toBeGreaterThanOrEqual(0)
  })

  it('records a call the tool refused, not only one it ran', async () => {
    // A refusal never reaches the handler, so the handler cannot log it.
    const onCall = vi.fn()
    const registry = tools(
      {
        export_report: {
          description: 'Export the report',
          execute: () => 'exported',
          when: () => 'Exports are not included in this workspace plan.',
        },
      },
      { onCall },
    )
    await registry.mount()
    const [tool] = await modelContext().getTools()

    await modelContext().executeTool(tool!, '{}')

    expect(onCall.mock.calls[0]![0]).toMatchObject({
      name: 'export_report',
      result: 'Exports are not included in this workspace plan.',
    })
  })

  it('delivers the result even when the sink throws', async () => {
    // A sink whose endpoint is down must not turn a completed order into an
    // error the agent reports.
    const registry = tools(
      { checkout: { description: 'Place the order', execute: () => 'Order placed' } },
      {
        onCall: () => {
          throw new Error('sink unreachable')
        },
      },
    )
    await registry.mount()
    const [tool] = await modelContext().getTools()

    await expect(modelContext().executeTool(tool!, '{}')).resolves.toBe('Order placed')
  })

  it('audits the on-device path too', async () => {
    // `localTools` shares the executor, so a tool called by Gemini Nano in the
    // page is recorded exactly like one called by a remote agent.
    const onCall = vi.fn()
    const [tool] = localTools(
      { checkout: { description: 'Place the order', execute: () => 'Order placed' } },
      { onCall },
    )

    await tool!.execute({})

    expect(onCall.mock.calls[0]![0]).toMatchObject({ name: 'checkout', result: 'Order placed' })
  })
})
