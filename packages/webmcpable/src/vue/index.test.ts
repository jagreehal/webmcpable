import { mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it } from 'vitest'
import { defineComponent, h, ref } from 'vue'
import * as z from 'zod'
import { modelContext } from '../model-context'
import { installTestModelContext } from '../testing/index'
import { useTools } from './index'

const names = async () => (await modelContext().getTools()).map((t) => t.name).sort()
const tick = () => new Promise((r) => setTimeout(r, 0))

describe('useTools (vue)', () => {
  beforeEach(() => installTestModelContext())

  it('registers tools while the component is mounted', async () => {
    const App = defineComponent({
      setup() {
        useTools({ search: { description: 'Search things', execute: () => 'ok' } })
        return () => h('div')
      },
    })
    mount(App)
    await tick()
    expect(await names()).toEqual(['search'])
  })

  it('unregisters on unmount', async () => {
    const App = defineComponent({
      setup() {
        useTools({ search: { description: 'Search things', execute: () => 'ok' } })
        return () => h('div')
      },
    })
    const wrapper = mount(App)
    await tick()
    wrapper.unmount()
    expect(await names()).toEqual([])
  })

  it('revalidates `when` from Vue reactivity, with no manual call', async () => {
    const count = ref(0)
    const App = defineComponent({
      setup() {
        useTools({
          checkout: {
            description: 'Check out the cart',
            execute: () => 'ok',
            when: () => count.value > 0,
          },
        })
        return () => h('div')
      },
    })
    mount(App)
    await tick()
    expect(await names()).toEqual([])

    count.value = 1
    await tick()
    expect(await names()).toEqual(['checkout'])
  })

  it('passes typed input to the handler', async () => {
    const App = defineComponent({
      setup() {
        useTools({
          greet: {
            description: 'Greet someone by name',
            execute: ({ name }) => `hello ${name}`,
            input: z.object({ name: z.string() }),
          },
        })
        return () => h('div')
      },
    })
    mount(App)
    await tick()
    const [tool] = await modelContext().getTools()
    await expect(modelContext().executeTool(tool!, '{"name":"jag"}')).resolves.toBe('hello jag')
  })
})
