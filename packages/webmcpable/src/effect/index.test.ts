import { Effect, SubscriptionRef } from 'effect'
import { beforeEach, describe, expect, it } from 'vitest'
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
            search: { description: 'Search things', handler: () => Effect.succeed('ok') },
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
              handler: ({ name }) => Effect.succeed(`hello ${name}`),
              input: z.object({ name: z.string() }),
            },
          })
          yield* registry.mount
          const [tool] = yield* Effect.promise(() => modelContext().getTools())
          const result = yield* Effect.promise(() =>
            modelContext().executeTool(tool!, '{"name":"jag"}'),
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
              handler: () => Effect.fail(new ToolFailure({ message: 'out of stock' })),
            },
          })
          yield* registry.mount
          const [tool] = yield* Effect.promise(() => modelContext().getTools())
          const result = yield* Effect.promise(() => modelContext().executeTool(tool!, '{}'))
          expect(result).toContain('out of stock')
        }),
      ),
    )
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
                handler: () => Effect.succeed('ordered'),
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
              handler: () => Effect.succeed('exported'),
              when: () => Effect.succeed('Exports are not included in this workspace plan.'),
            },
          })
          yield* registry.mount
          const [tool] = yield* Effect.promise(() => modelContext().getTools())
          const result = yield* Effect.promise(() => modelContext().executeTool(tool!, '{}'))
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
            a: { description: 'A tool that does a thing', handler: () => Effect.succeed('ok') },
          })
          yield* registry.mount
          const live = yield* Effect.promise(() => modelContext().getTools())
          expect(live.length).toBe(1)
        }),
      ),
    )
    expect(await names()).toEqual([])
  })
})
