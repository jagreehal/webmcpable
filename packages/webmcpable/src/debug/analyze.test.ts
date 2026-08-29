import { describe, expect, it } from 'vitest'
import { analyzeResult, analyzeTool } from './analyze'

const codes = (xs: Array<{ code: string }>) => xs.map((x) => x.code).sort()

describe('analyzeResult — what the agent actually received', () => {
  it('flags an MCP envelope, which Chrome never unwraps', () => {
    const out = analyzeResult('{"content":[{"type":"text","text":"hi"}]}')
    expect(codes(out)).toContain('mcp-envelope')
    expect(out[0]!.message).toMatch(/unwrap/i)
  })

  it('flags the literal string "undefined"', () => {
    expect(codes(analyzeResult('undefined'))).toContain('undefined-result')
  })

  it('is quiet for a plain string result', () => {
    expect(analyzeResult('Added 2 items to your cart')).toEqual([])
  })

  it('is quiet for plain JSON data', () => {
    expect(analyzeResult('{"items":[1,2]}')).toEqual([])
  })

  it('flags an empty result as invisible to the agent', () => {
    expect(codes(analyzeResult(''))).toContain('empty-result')
  })
})

describe('analyzeTool — will an agent be able to use this?', () => {
  const base = { description: 'Search the product catalogue by keyword', name: 'search' }

  it('is quiet for a well-formed tool', () => {
    expect(
      analyzeTool({
        ...base,
        inputSchema: { properties: { q: { description: 'the query', type: 'string' } }, type: 'object' },
      }),
    ).toEqual([])
  })

  it('flags a description too thin for an agent to choose on', () => {
    expect(codes(analyzeTool({ ...base, description: 'search' }))).toContain('thin-description')
  })

  it('flags schema properties with no description', () => {
    const out = analyzeTool({
      ...base,
      inputSchema: { properties: { q: { type: 'string' } }, type: 'object' },
    })
    expect(codes(out)).toContain('undescribed-parameter')
    expect(out[0]!.message).toContain('q')
  })

  it('flags names the spec forbids', () => {
    expect(codes(analyzeTool({ ...base, name: 'search products!' }))).toContain('invalid-name')
  })

  it('flags annotations the draft does not define', () => {
    const out = analyzeTool({ ...base, annotations: { destructiveHint: true } })
    expect(codes(out)).toContain('unknown-annotation')
    expect(out[0]!.message).toContain('destructiveHint')
  })

  it('accepts the two annotations that do exist', () => {
    expect(
      analyzeTool({ ...base, annotations: { readOnlyHint: true, untrustedContentHint: false } }),
    ).toEqual([])
  })

  it('parses inputSchema when Chrome hands it back as a JSON string', () => {
    const out = analyzeTool({
      ...base,
      inputSchema: '{"type":"object","properties":{"q":{"type":"string"}}}',
    })
    expect(codes(out)).toContain('undescribed-parameter')
  })
})
