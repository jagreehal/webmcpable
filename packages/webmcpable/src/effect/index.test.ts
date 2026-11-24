import { Effect, SubscriptionRef } from 'effect'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as z from 'zod'
import { modelContext } from '../model-context'
import { installTestModelContext } from '../testing/index'
import { ToolFailure, effectTools } from './index'

const names = async () => (await modelContext().getTools()).map((t) => t.name).sort()
const run = <A, E>(e: Effect.Effect<A, E, never>) => Effect.runPromise(e)

describe('effectTools', () => {
  beforeEach(() => installTestModelContext())

  it('registers tools whose handlers are Effects', async () => {
    await run(
      Effect.scoped(
        Effect.gen(function* () {
          const registry = yield* effectTools({
            search: { description: 'Search things', execute: () => Effect.succeed('ok') },
          })
          yield* registry.mount
          expect(yield* Effect.promise(names)).toEqual(['search'])
        }),
      ),
    )
  })

  it('returns the success value to the agent', async () => {
    await run(
      Effect.scoped(
        Effect.gen(function* () {
          const registry = yield* effectTools({
            greet: {
              description: 'Greet someone by name',
              execute: ({ name }) => Effect.succeed(`hello ${name}`),
              input: z.object({ name: z.string() }),
            },
          })
          yield* registry.mount
          const [tool] = yield* Effect.promise(() => modelContext().getTools())
          const result = yield* Effect.promise(() =>
            modelContext().executeTool(tool!, {"name":"jag"}),
          )
          expect(result).toBe('hello jag')
        }),
      ),
    )
  })

  it('turns a typed failure into text the agent can read', async () => {
    // Chrome erases thrown errors, so a failure has to be *returned*.
    await run(
      Effect.scoped(
        Effect.gen(function* () {
          const registry = yield* effectTools({
            risky: {
              description: 'Something that can fail',
              execute: () => Effect.fail(new ToolFailure({ message: 'out of stock' })),
            },
          })
          yield* registry.mount
          const [tool] = yield* Effect.promise(() => modelContext().getTools())
          const result = yield* Effect.promise(() => modelContext().executeTool(tool!, {}))
          expect(result).toContain('out of stock')
        }),
      ),
    )
  })

  it('honours confirm on a single tool, over the registry', async () => {
    const ran: Array<string> = []
    await run(
      Effect.scoped(
        Effect.gen(function* () {
          const registry = yield* effectTools(
            {
              close: {
                confirm: () => false,
                description: 'Close the account',
                execute: () => Effect.sync(() => ran.push('close')),
              },
              open: { confirm: false, description: 'Open the account', execute: () => Effect.succeed('opened') },
            },
            { confirm: () => false },
          )
          yield* registry.mount
          const [close, open] = yield* Effect.promise(() => modelContext().getTools())
          expect(yield* Effect.promise(() => modelContext().executeTool(close!, {}))).toBe('close was not confirmed.')
          expect(yield* Effect.promise(() => modelContext().executeTool(open!, {}))).toBe('opened')
        }),
      ),
    )
    expect(ran).toEqual([])
  })

  it('passes exposed origins to the browser', async () => {
    const registerTool = vi.spyOn(modelContext(), 'registerTool')
    const exposedTo = ['https://agent.example']
    await run(
      Effect.scoped(
        Effect.gen(function* () {
          const registry = yield* effectTools({
            a: { description: 'A tool', execute: () => Effect.succeed('ok'), exposedTo },
          })
          yield* registry.mount
        }),
      ),
    )
    expect(registerTool).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'a' }),
      expect.objectContaining({ exposedTo }),
    )
  })

  it('reports calls to onCall', async () => {
    const seen: Array<string> = []
    await run(
      Effect.scoped(
        Effect.gen(function* () {
          const registry = yield* effectTools(
            { open: { description: 'Open the account', execute: () => Effect.succeed('opened') } },
            { onCall: ({ name, result }) => seen.push(`${name}:${result}`) },
          )
          yield* registry.mount
          const [tool] = yield* Effect.promise(() => modelContext().getTools())
          yield* Effect.promise(() => modelContext().executeTool(tool!, {}))
        }),
      ),
    )
    expect(seen).toEqual(['open:opened'])
  })

  it('re-evaluates `when` when a SubscriptionRef changes, with no manual call', async () => {
    const cart = await run(SubscriptionRef.make(0))

    await run(
      Effect.scoped(
        Effect.gen(function* () {
          const registry = yield* effectTools(
            {
              checkout: {
                description: 'Check out the cart',
                execute: () => Effect.succeed('ordered'),
                when: () => Effect.map(SubscriptionRef.get(cart), (n) => n > 0),
              },
            },
            { watch: [cart] },
          )
          yield* registry.mount
          expect(yield* Effect.promise(names)).toEqual([])

          yield* SubscriptionRef.set(cart, 1)
          yield* Effect.sleep('20 millis')
          expect(yield* Effect.promise(names)).toEqual(['checkout'])
        }),
      ),
    )
  })

  it('refuses with the reason a `when` Effect returns', async () => {
    await run(
      Effect.scoped(
        Effect.gen(function* () {
          const registry = yield* effectTools({
            export_report: {
              description: 'Export the report',
              execute: () => Effect.succeed('exported'),
              when: () => Effect.succeed('Exports are not included in this workspace plan.'),
            },
          })
          yield* registry.mount
          const [tool] = yield* Effect.promise(() => modelContext().getTools())
          const result = yield* Effect.promise(() => modelContext().executeTool(tool!, {}))
          expect(result).toBe('Exports are not included in this workspace plan.')
        }),
      ),
    )
  })

  it('unregisters everything when the scope closes', async () => {
    await run(
      Effect.scoped(
        Effect.gen(function* () {
          const registry = yield* effectTools({
            a: {
              description: 'A tool that does a thing',
              execute: () => Effect.succeed('ok'),
              outputSchema: { type: 'string' },
            },
          })
          yield* registry.mount
          const live = yield* Effect.promise(() => modelContext().getTools())
          expect(live.length).toBe(1)
          expect(live[0]!.outputSchema).toEqual({ type: 'string' })
        }),
      ),
    )
    expect(await names()).toEqual([])
  })
})
