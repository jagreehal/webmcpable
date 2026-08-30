import { describe, expect, it } from 'vitest'
import { buildReport, type ReportRow } from './report'

const env = { supported: true, userAgent: 'Chrome/151' }

const row = (over: Partial<ReportRow> = {}): ReportRow => ({
  findings: [],
  tool: { description: 'does a thing properly', name: 'a' },
  ...over,
})

describe('buildReport', () => {
  it('records the environment', () => {
    const out = buildReport(env, [])
    expect(out).toContain('Chrome/151')
    expect(out).toContain('tools registered: 0')
  })

  it('says clearly when WebMCP is missing', () => {
    expect(buildReport({ ...env, supported: false }, [])).toMatch(/MISSING/)
  })

  it('reports the annotations the browser kept', () => {
    const out = buildReport(env, [row({ tool: { annotations: { readOnlyHint: true }, name: 'a' } })])
    expect(out).toContain('readOnlyHint')
  })

  it('says "none" when the browser kept no annotations', () => {
    expect(buildReport(env, [row()])).toMatch(/annotations kept: none/)
  })

  it('includes the exact string the agent received', () => {
    const out = buildReport(env, [row({ lastInput: '{"q":"x"}', lastResult: 'hello' })])
    expect(out).toContain('{"q":"x"}')
    expect(out).toContain('agent receives: `hello`')
  })

  it('includes findings on both the tool and its result', () => {
    const out = buildReport(env, [
      row({
        findings: [{ code: 'thin-description', message: 'too short', severity: 'warning' }],
        resultFindings: [{ code: 'mcp-envelope', message: 'wrapped', severity: 'error' }],
      }),
    ])
    expect(out).toContain('thin-description')
    expect(out).toContain('mcp-envelope')
  })

  it('reports a rejected invocation', () => {
    const out = buildReport(env, [row({ lastError: 'UnknownError: nope' })])
    expect(out).toMatch(/rejected.*UnknownError: nope/)
  })

  it('records a journal of resolved calls, not labels', () => {
    const out = buildReport(
      {
        ...env,
        calls: [
          { input: '{"address":"PO Box 1"}', name: 'update_shipping_address', result: 'shipped' },
        ],
      },
      [row()],
    )
    expect(out).toContain('## calls')
    expect(out).toContain('update_shipping_address')
    expect(out).toContain('{"address":"PO Box 1"}')
  })

  it('reports every field the panel displays, so the two cannot drift', () => {
    const out = buildReport(env, [
      row({
        lastInput: '{}',
        lastResult: 'ok',
        tool: { annotations: { readOnlyHint: true }, description: 'd', inputSchema: { type: 'object' }, name: 'a' },
      }),
    ])
    for (const expected of ['a', 'description:', 'title:', 'annotations kept:', 'input:', 'agent receives:']) {
      expect(out).toContain(expected)
    }
  })
})
