import { act, render } from '@testing-library/react'
import { StrictMode, useState } from 'react'
import { beforeEach, describe, expect, it } from 'vitest'
import * as z from 'zod'
import { modelContext } from '../model-context'
import { installTestModelContext } from '../testing/index'
import { useTools } from './index'

const names = async () => (await modelContext().getTools()).map((t) => t.name).sort()

describe('useTools', () => {
  beforeEach(() => installTestModelContext())

  it('registers tools while the component is mounted', async () => {
    function App() {
      useTools({ search: { description: 'Search things', execute: () => 'ok' } })
      return null
    }
    render(<App />)
    expect(await names()).toEqual(['search'])
  })

  it('unregisters on unmount', async () => {
    function App() {
      useTools({ search: { description: 'Search things', execute: () => 'ok' } })
      return null
    }
    const { unmount } = render(<App />)
    unmount()
    expect(await names()).toEqual([])
  })

  it('survives StrictMode double-mounting without duplicate registration', async () => {
    function App() {
      useTools({ search: { description: 'Search things', execute: () => 'ok' } })
      return null
    }
    // StrictMode mounts, unmounts and remounts. A naive effect either throws
    // "already registered" or leaves an orphan behind.
    render(
      <StrictMode>
        <App />
      </StrictMode>,
    )
    expect(await names()).toEqual(['search'])
  })

  it('revalidates `when` as state changes, with no manual call', async () => {
    let add: () => void = () => {}
    function App() {
      const [count, setCount] = useState(0)
      add = () => setCount((c) => c + 1)
      useTools({
        checkout: { description: 'Check out the cart', execute: () => 'ok', when: () => count > 0 },
      })
      return null
    }
    render(<App />)
    expect(await names()).toEqual([])

    // act() flushes the render and its effects; the extra await lets
    // revalidate()'s promise chain settle before we look.
    await act(async () => {
      add()
    })
    await Promise.resolve()
    expect(await names()).toEqual(['checkout'])
  })

  it('updates registration metadata without changing the tool name', async () => {
    let rename: () => void = () => {}
    function App() {
      const [description, setDescription] = useState('Search the first catalog')
      rename = () => setDescription('Search the second catalog')
      useTools({ search: { description, execute: () => 'ok' } })
      return null
    }
    render(<App />)
    expect((await modelContext().getTools())[0]?.description).toBe('Search the first catalog')

    await act(async () => rename())

    expect((await modelContext().getTools())[0]?.description).toBe('Search the second catalog')
  })

  it('does not send title when titles is off', async () => {
    function App() {
      useTools({
        checkout: {
          description: 'Place the order for the current cart',
          execute: () => 'ok',
          title: 'Add 2 coffees',
        },
      }, { titles: 'off' })
      return null
    }
    render(<App />)
    expect((await modelContext().getTools())[0]?.title).toBe('')
  })

  it('passes typed input through to the handler', async () => {
    function App() {
      useTools({
        greet: {
          description: 'Greet someone by name',
          execute: ({ name }) => `hello ${name}`,
          input: z.object({ name: z.string() }),
        },
      })
      return null
    }
    render(<App />)
    const [tool] = await modelContext().getTools()
    await expect(modelContext().executeTool(tool!, '{"name":"jag"}')).resolves.toBe('hello jag')
  })
  it('still knows the descriptor moved when metadata changes', async () => {
    const asked: Array<{ descriptorChanged: boolean }> = []
    function App({ description }: { description: string }) {
      useTools(
        { checkout: { description, execute: () => 'ordered' } },
        { confirm: (call) => { asked.push(call); return true } },
      )
      return null
    }

    const { rerender } = render(<App description="Place the order" />)
    await act(async () => {})

    // The tool the user first saw is not the tool that is registered now.
    rerender(<App description="Place the order, and email the receipt" />)
    await act(async () => {})

    const [tool] = await modelContext().getTools()
    expect(await modelContext().executeTool(tool!, '{}')).toBe('ordered')
    expect(asked[0]!.descriptorChanged).toBe(true)
  })
  it('keeps consent history when an unrelated tool appears', async () => {
    const asked: Array<{ descriptorChanged: boolean }> = []
    function App({ description, withHelp }: { description: string; withHelp: boolean }) {
      useTools(
        {
          checkout: { description, execute: () => 'ordered' },
          ...(withHelp ? { help: { description: 'Get help', execute: () => 'helped' } } : {}),
        },
        { confirm: (call) => { asked.push(call); return true } },
      )
      return null
    }

    const { rerender } = render(<App description="Place the order" withHelp={false} />)
    await act(async () => {})
    rerender(<App description="Place the order, and email the receipt" withHelp={false} />)
    await act(async () => {})

    // A second tool arriving says nothing about the first one's descriptor.
    rerender(<App description="Place the order, and email the receipt" withHelp />)
    await act(async () => {})

    const tools = await modelContext().getTools()
    const checkout = tools.find((t) => t.name === 'checkout')!
    expect(await modelContext().executeTool(checkout, '{}')).toBe('ordered')
    expect(asked[0]!.descriptorChanged).toBe(true)
  })

  it('unregisters a tool that disappears from the definitions', async () => {
    function App({ withHelp }: { withHelp: boolean }) {
      useTools({
        checkout: { description: 'Place the order', execute: () => 'ordered' },
        ...(withHelp ? { help: { description: 'Get help', execute: () => 'helped' } } : {}),
      })
      return null
    }

    const { rerender } = render(<App withHelp />)
    await act(async () => {})
    expect(await names()).toEqual(['checkout', 'help'])

    rerender(<App withHelp={false} />)
    await act(async () => {})
    expect(await names()).toEqual(['checkout'])
  })
  it('re-registers when the titles option changes', async () => {
    function App({ titles }: { titles?: 'off' }) {
      useTools(
        { checkout: { description: 'Place the order', execute: () => 'ordered', title: 'Friendly checkout' } },
        { titles },
      )
      return null
    }

    const { rerender } = render(<App />)
    await act(async () => {})
    expect((await modelContext().getTools())[0]!.title).toBe('Friendly checkout')

    rerender(<App titles="off" />)
    await act(async () => {})
    expect((await modelContext().getTools())[0]!.title).toBe('')
  })
})
