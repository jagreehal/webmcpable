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
      useTools({ search: { description: 'Search things', handler: () => 'ok' } })
      return null
    }
    render(<App />)
    expect(await names()).toEqual(['search'])
  })

  it('unregisters on unmount', async () => {
    function App() {
      useTools({ search: { description: 'Search things', handler: () => 'ok' } })
      return null
    }
    const { unmount } = render(<App />)
    unmount()
    expect(await names()).toEqual([])
  })

  it('survives StrictMode double-mounting without duplicate registration', async () => {
    function App() {
      useTools({ search: { description: 'Search things', handler: () => 'ok' } })
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
        checkout: { description: 'Check out the cart', handler: () => 'ok', when: () => count > 0 },
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
      useTools({ search: { description, handler: () => 'ok' } })
      return null
    }
    render(<App />)
    expect((await modelContext().getTools())[0]?.description).toBe('Search the first catalog')

    await act(async () => rename())

    expect((await modelContext().getTools())[0]?.description).toBe('Search the second catalog')
  })

  it('passes typed input through to the handler', async () => {
    function App() {
      useTools({
        greet: {
          description: 'Greet someone by name',
          handler: ({ name }) => `hello ${name}`,
          input: z.object({ name: z.string() }),
        },
      })
      return null
    }
    render(<App />)
    const [tool] = await modelContext().getTools()
    await expect(modelContext().executeTool(tool!, '{"name":"jag"}')).resolves.toBe('hello jag')
  })
})
