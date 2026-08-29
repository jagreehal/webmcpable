import { afterEach, describe, expect, it, vi } from 'vitest'
import { isSupported, modelContext } from './model-context'

describe('modelContext', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('reports no support outside a browser document', () => {
    vi.stubGlobal('document', undefined)

    expect(isSupported()).toBe(false)
    expect(() => modelContext()).toThrow('outside a browser document')
  })
})
