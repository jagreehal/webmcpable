import { flushSync } from 'svelte'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as z from 'zod'
import { modelContext } from '../model-context'
import { installTestModelContext } from '../testing/index'
import { useTools } from './index.svelte'

const names = async () => (await modelContext().getTools()).map((t) => t.name).sort()
const tick = () => new Promise((r) => setTimeout(r, 0))

describe('useTools (svelte)', () => {
  beforeEach(() => installTestModelContext())

  it('registers tools inside an effect root', async () => {
    const cleanup = $effect.root(() => {
      useTools({ search: { description: 'Search things', handler: () => 'ok' } })
    })
    flushSync()
    await tick()
    expect(await names()).toEqual(['search'])
    cleanup()
  })

  it('unregisters when the effect root is torn down', async () => {
    const cleanup = $effect.root(() => {
      useTools({ search: { description: 'Search things', handler: () => 'ok' } })
    })
    flushSync()
    await tick()
    cleanup()
    flushSync()
    expect(await names()).toEqual([])
  })

  it('revalidates `when` from Svelte reactivity, with no manual call', async () => {
    let count = $state(0)
    const cleanup = $effect.root(() => {
      useTools({
        checkout: {
          description: 'Check out the cart',
          handler: () => 'ok',
          when: () => count > 0,
        },
      })
    })
    flushSync()
    await tick()
    expect(await names()).toEqual([])

    count = 1
    flushSync()
    await tick()
    expect(await names()).toEqual(['checkout'])
    cleanup()
  })

  it('keeps an eligible tool registered across reactive changes', async () => {
    let count = $state(0)
    const registerTool = vi.spyOn(modelContext(), 'registerTool')
    const cleanup = $effect.root(() => {
      useTools({
        status: {
          description: 'Read the current count',
          handler: () => String(count),
          when: () => count >= 0,
        },
      })
    })
    flushSync()
    await tick()

    count = 1
    flushSync()
    await tick()

    expect(registerTool).toHaveBeenCalledTimes(1)
    cleanup()
  })

  it('passes typed input to the handler', async () => {
    const cleanup = $effect.root(() => {
      useTools({
        greet: {
          description: 'Greet someone by name',
          handler: ({ name }) => `hello ${name}`,
          input: z.object({ name: z.string() }),
        },
      })
    })
    flushSync()
    await tick()
    const [tool] = await modelContext().getTools()
    await expect(modelContext().executeTool(tool!, '{"name":"jag"}')).resolves.toBe('hello jag')
    cleanup()
  })
})
