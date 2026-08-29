import { describe, expect, it } from 'vitest'
import { scanSource } from './rules'

const scan = (src: string) => scanSource('app.ts', src)
const codes = (src: string) => scan(src).map((f) => f.code)

describe('scanSource', () => {
  it('is quiet on correct code', () => {
    expect(
      scan(`
        await document.modelContext.registerTool(
          { name: 'a', description: 'does a thing', execute: () => 'ok' },
          { signal: controller.signal },
        )
      `),
    ).toEqual([])
  })

  it('flags navigator.modelContext as an undocumented alias', () => {
    const [finding] = scan('navigator.modelContext.registerTool(t)')
    expect(finding!.code).toBe('navigator-alias')
    expect(finding!.line).toBe(1)
    expect(finding!.fix).toContain('document.modelContext')
  })

  it('flags unregisterTool, which the draft does not define', () => {
    const [finding] = scan('document.modelContext.unregisterTool("a")')
    expect(finding!.code).toBe('no-unregister-tool')
    expect(finding!.fix).toMatch(/AbortSignal/i)
  })

  it.each(['destructiveHint', 'idempotentHint', 'openWorldHint', 'confirmationHint', 'safetyLevel'])(
    'flags the invented annotation %s',
    (key) => {
      const findings = scan(`annotations: { ${key}: true }`)
      expect(findings[0]!.code).toBe('unknown-annotation')
      expect(findings[0]!.message).toContain(key)
    },
  )

  it('accepts the two annotations the draft defines', () => {
    expect(codes('annotations: { readOnlyHint: true, untrustedContentHint: false }')).toEqual([])
  })

  it('flags executeTool called with an object literal', () => {
    const [finding] = scan("mc.executeTool(tool, { q: 'x' })")
    expect(finding!.code).toBe('execute-tool-object')
    expect(finding!.fix).toContain('JSON.stringify')
  })

  it('accepts executeTool called with a string', () => {
    expect(codes('mc.executeTool(tool, JSON.stringify(args))')).toEqual([])
  })

  it('flags returning an MCP envelope', () => {
    const [finding] = scan("return { content: [{ type: 'text', text: 'hi' }] }")
    expect(finding!.code).toBe('mcp-envelope')
  })

  it('flags JSON.stringify on getTools output, which is circular', () => {
    const [finding] = scan('const tools = await mc.getTools(); JSON.stringify(tools)')
    expect(finding!.code).toBe('stringify-registered-tool')
  })

  it('reports accurate line numbers', () => {
    const findings = scan('const a = 1\nconst b = 2\nnavigator.modelContext.getTools()')
    expect(findings[0]!.line).toBe(3)
  })

  it('ignores matches inside line comments', () => {
    expect(codes('// navigator.modelContext is the old alias')).toEqual([])
  })

  it('ignores matches inside block comments', () => {
    expect(codes('/* navigator.modelContext is the old alias */')).toEqual([])
  })

  it('ignores matches inside string literals', () => {
    expect(codes(`const doc = 'navigator.modelContext is legacy'`)).toEqual([])
    expect(codes('const keys = ["destructiveHint", "idempotentHint"]')).toEqual([])
    expect(codes('const re = new RegExp("unregisterTool")')).toEqual([])
  })

  it('still flags real code on a line that also contains a string', () => {
    const findings = scan(`const label = 'legacy'; navigator.modelContext.getTools()`)
    expect(findings.map((f) => f.code)).toEqual(['navigator-alias'])
  })

  it('keeps column numbers accurate when strings are stripped', () => {
    const src = `const s = 'xxxxxxxx'; navigator.modelContext.getTools()`
    expect(scan(src)[0]!.column).toBe(src.indexOf('navigator') + 1)
  })

  it('honours an ignore comment', () => {
    expect(codes('navigator.modelContext.getTools() // webmcpable-ignore')).toEqual([])
  })

  it('flags a description built from a template literal', () => {
    const [finding] = scan('  description: `Search results for ${query}`,')
    expect(finding!.code).toBe('dynamic-description')
    expect(finding!.fix).toContain('fixed string')
  })

  it('flags an interpolated title the same way', () => {
    expect(codes('  title: `Order ${id}`,')).toEqual(['dynamic-description'])
  })

  it('accepts a description that is a plain string', () => {
    expect(codes("  description: 'Search the product catalogue',")).toEqual([])
  })

  it('accepts a template literal with nothing interpolated', () => {
    expect(codes('  description: `Search the product catalogue`,')).toEqual([])
  })
})
