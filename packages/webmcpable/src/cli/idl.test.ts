import { describe, expect, it } from 'vitest'
import { extractIdl, diffIdl } from './idl'

const BS = `
Some prose about tools.

<xmp class="idl">
partial interface Document {
  [SameObject] readonly attribute ModelContext modelContext;
};
</xmp>

More prose, and a JavaScript example that must not be picked up:

<xmp class=language-js>
document.modelContext.registerTool({ name: 'a' });
</xmp>

<xmp class="idl">
dictionary ToolAnnotations {
  boolean readOnlyHint = false;
};
</xmp>
`

describe('extractIdl', () => {
  it('pulls every IDL block from a bikeshed source', () => {
    const blocks = extractIdl(BS)
    expect(blocks).toHaveLength(2)
    expect(blocks[0]).toContain('partial interface Document')
    expect(blocks[1]).toContain('dictionary ToolAnnotations')
  })

  it('ignores JavaScript examples', () => {
    expect(extractIdl(BS).join('\n')).not.toContain('registerTool({')
  })

  it('normalises whitespace so reformatting is not reported as drift', () => {
    const a = extractIdl('<xmp class="idl">\ndictionary A {\n  boolean x;\n};\n</xmp>')
    const b = extractIdl('<xmp class="idl">\ndictionary A {\n    boolean x;\n};\n\n</xmp>')
    expect(a).toEqual(b)
  })

  it('returns nothing when there is no IDL', () => {
    expect(extractIdl('just prose')).toEqual([])
  })
})

describe('diffIdl', () => {
  const before = ['dictionary A {\nboolean x;\n};']

  it('reports no drift when the IDL is unchanged', () => {
    expect(diffIdl(before, [...before])).toEqual([])
  })

  it('reports an added member', () => {
    const after = ['dictionary A {\nboolean x;\nboolean y;\n};']
    const drift = diffIdl(before, after)
    expect(drift).toHaveLength(1)
    expect(drift[0]!.added).toContain('boolean y;')
  })

  it('reports a removed member', () => {
    const drift = diffIdl(['dictionary A {\nboolean x;\nboolean y;\n};'], before)
    expect(drift[0]!.removed).toContain('boolean y;')
  })

  it('reports a whole block being added', () => {
    const drift = diffIdl(before, [...before, 'dictionary B {\n};'])
    expect(drift.some((d) => d.added.some((l) => l.includes('dictionary B')))).toBe(true)
  })
})
