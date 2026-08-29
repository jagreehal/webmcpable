import { describe, expect, it } from 'vitest'
import { toToolResult } from './result'

// Every expectation here is measured Chrome behaviour, re-confirmed on 152.
// See spike/SPIKE-FINDINGS.md — do not change without re-running the
// conformance lane (`pnpm --filter webmcpable test:conformance`).
describe('toToolResult', () => {
  it('passes strings through untouched', async () => {
    expect(await toToolResult(() => 'hello')).toBe('hello')
  })

  it('does not wrap in an MCP envelope (Chrome never unwraps it)', async () => {
    const out = await toToolResult(() => 'hello')
    expect(out).not.toContain('content')
  })

  it('maps undefined to empty string, not the literal "undefined"', async () => {
    expect(await toToolResult(() => undefined)).toBe('')
  })

  it('serialises objects as JSON', async () => {
    expect(await toToolResult(() => ({ a: 1 }))).toBe('{"a":1}')
  })

  it('serialises null and numbers', async () => {
    expect(await toToolResult(() => null)).toBe('null')
    expect(await toToolResult(() => 42)).toBe('42')
  })

  it('returns thrown errors as readable text (Chrome erases thrown messages)', async () => {
    const out = await toToolResult(() => {
      throw new Error('boom')
    })
    expect(out).toContain('boom')
  })

  it('awaits async handlers', async () => {
    expect(await toToolResult(async () => 'later')).toBe('later')
  })
})
