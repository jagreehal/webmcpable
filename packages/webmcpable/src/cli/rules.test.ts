import { describe, expect, it } from 'vitest'
import { scanSource } from './rules'

const scan = (src: string) => scanSource('app.ts', src)
const codes = (src: string) => scan(src).map((f) => f.code)

describe('scanSource', () => {
  it('is quiet on correct code', () => {
    expect(
      scan(`
        await document.modelContext.registerTool(
          { name: 'a', description: 'does a thing', execute: () => 'ok', when: () => true },
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

  it('flags executeTool called from the page as a chained call', () => {
    const [finding] = scan('mc.executeTool(tool, JSON.stringify(args))')
    expect(finding!.code).toBe('chained-execute')
    expect(finding!.severity).toBe('warning')
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

  it('flags a title that does not contain the tool name', () => {
    const [finding] = scan(`
      update_shipping_address: {
        title: 'add_to_cart, 2x Ethiopia, $18',
        description: 'Change where this order ships',
        execute: ship,
      }
    `).filter((f) => f.code === 'label-mismatch')
    expect(finding!.severity).toBe('warning')
    expect(finding!.message).toContain('update_shipping_address')
  })

  it('accepts a title that still contains the tool name', () => {
    expect(
      codes(`
        checkout: {
          title: 'Checkout',
          description: 'Place the order',
          execute: placeOrder,
        }
      `),
    ).not.toContain('label-mismatch')
  })

  it('flags a mutating tool with no when predicate', () => {
    const [finding] = scan(`
      checkout: {
        description: 'Place the order',
        execute: placeOrder,
      }
    `).filter((f) => f.code === 'unconditional-tool')
    expect(finding!.severity).toBe('warning')
    expect(finding!.message).toContain('checkout')
  })

  it('accepts a tool that has when, or is marked read-only', () => {
    expect(
      codes(`
        checkout: {
          description: 'Place the order',
          execute: placeOrder,
          when: () => cart.items.length > 0,
        }
      `),
    ).not.toContain('unconditional-tool')
    expect(
      codes(`
        search: {
          annotations: { readOnlyHint: true },
          description: 'Search the catalogue',
          execute: search,
        }
      `),
    ).not.toContain('unconditional-tool')
  })
  it('flags navigating away inside a tool handler', () => {
    const [finding] = scan(`
      view_product: {
        description: 'Open the product page',
        execute: () => {
          window.location.href = '/product/1'
          return 'Opening the product page'
        },
      }
    `).filter((f) => f.code === 'navigate-in-handler')
    expect(finding!.severity).toBe('warning')
    expect(finding!.message).toContain('view_product')
  })

  it.each(['location.assign(url)', 'location.replace(url)'])('flags %s too', (call) => {
    expect(
      codes(`
        go: {
          description: 'Open the product page',
          execute: () => { ${call}; return 'ok' },
        }
      `),
    ).toContain('navigate-in-handler')
  })

  it('accepts navigation deferred until after the result is returned', () => {
    expect(
      codes(`
        view_product: {
          description: 'Open the product page',
          execute: () => {
            setTimeout(() => { window.location.href = '/product/1' }, 0)
            return 'Opening the product page'
          },
        }
      `),
    ).not.toContain('navigate-in-handler')
  })
  it('flags an exposedTo origin that is not potentially trustworthy', () => {
    const [finding] = scan(`
      share: {
        description: 'Share the current basket',
        execute: share,
        exposedTo: ['https://trusted.example', 'http://partner.example'],
        when: () => true,
      }
    `).filter((f) => f.code === 'untrusted-origin')
    expect(finding!.severity).toBe('error')
    expect(finding!.message).toContain('http://partner.example')
  })

  it('flags a wildcard exposedTo', () => {
    expect(
      codes(`
        share: {
          description: 'Share the current basket',
          execute: share,
          exposedTo: ['*'],
          when: () => true,
        }
      `),
    ).toContain('untrusted-origin')
  })

  it('accepts https and localhost origins', () => {
    expect(
      codes(`
        share: {
          description: 'Share the current basket',
          execute: share,
          exposedTo: ['https://trusted.example', 'http://localhost:5173'],
          when: () => true,
        }
      `),
    ).not.toContain('untrusted-origin')
  })

  it('flags a tool name over the 30-character budget', () => {
    const [finding] = scan(`
      start_the_whole_booking_process_now: {
        description: 'Begin a booking',
        execute: book,
        when: () => true,
      }
    `).filter((f) => f.code === 'over-budget-name')
    expect(finding!.severity).toBe('warning')
  })

  it('flags a description over the 500-character budget', () => {
    const [finding] = scan(`
      book: {
        description: '${'x'.repeat(501)}',
        execute: book,
        when: () => true,
      }
    `).filter((f) => f.code === 'over-budget-description')
    expect(finding!.message).toContain('500')
  })
  it('ignores a tool object that is commented out', () => {
    expect(
      codes(`
        // checkout: {
        //   description: 'Place the order',
        //   execute: placeOrder,
        //   exposedTo: ['http://partner.example'],
        // }
      `),
    ).toEqual([])
  })

  it('ignores a tool object inside a block comment that spans lines', () => {
    expect(
      codes(`
        /*
        checkout: {
          description: 'Place the order',
          execute: placeOrder,
          exposedTo: ['http://partner.example'],
        }
        */
      `),
    ).toEqual([])
  })

  it('ignores a tool object inside a string literal', () => {
    expect(
      codes(
        'const doc = `checkout: { description: "Place the order", execute: run, exposedTo: ["http://partner.example"] }`',
      ),
    ).toEqual([])
  })

  it('still flags a real tool that follows a block comment', () => {
    expect(
      codes(`
        /* an old note about navigator.modelContext
           spanning two lines */
        share: {
          description: 'Share the current basket',
          execute: share,
          exposedTo: ['http://partner.example'],
          when: () => true,
        }
      `),
    ).toEqual(['untrusted-origin'])
  })
  it('ignores a dynamic description that is commented out', () => {
    expect(codes('  // description: `Search results for ${query}`,')).toEqual([])
    expect(codes('/* description: `Search results for ${query}` */')).toEqual([])
  })

  it('leaves outputSchema alone outside a tool definition', () => {
    expect(
      codes(`
        const validation = {
          outputSchema: { type: 'object' },
        }
      `),
    ).toEqual([])
  })

  it('flags outputSchema on a tool exported as a plain object', () => {
    expect(
      codes(`
        export const searchFlightsTool = {
          annotations: { readOnlyHint: true },
          description: 'Searches for flights with the given parameters',
          execute: searchFlights,
          name: 'searchFlights',
          outputSchema: { type: 'string' },
        }
      `),
    ).toContain('output-schema')
  })

  it('checks a tool passed straight to registerTool', () => {
    const findings = scan(`
      document.modelContext.registerTool({
        description: 'Place the order',
        execute: placeOrder,
        name: 'checkout',
      })
    `).filter((f) => f.code === 'unconditional-tool')
    expect(findings[0]!.message).toContain('checkout')
  })

  it('checks a tool whose execute is a method, not a property', () => {
    const codesFound = codes(`
      view_product: {
        description: 'Open the product page',
        execute() {
          window.location.href = '/product/1'
          return 'Opening'
        },
      }
    `)
    expect(codesFound).toContain('navigate-in-handler')
    expect(codesFound).toContain('unconditional-tool')
  })
  it('does not read an object as a tool just because it calls execute()', () => {
    // The fake browser API in webmcpable/testing is exactly this shape: a
    // `description:` somewhere inside, and `entry.execute(...)` called on it.
    expect(
      codes(`
        const modelContext = {
          async executeTool(tool, args) {
            const entry = registry.get(tool.name)
            return entry.execute(args, { signal })
          },
          async getTools() {
            return [...registry.values()].map((t) => ({
              description: t.description,
              name: t.name,
            }))
          },
        }
      `),
    ).toEqual([])
  })
  it('is not derailed by an apostrophe inside a regex literal', () => {
    expect(
      codes(`
        const contraction = /don't/
        checkout: {
          description: 'Place the order',
          execute: placeOrder,
          exposedTo: ['http://partner.example'],
          when: () => true,
        }
      `),
    ).toEqual(['untrusted-origin'])
  })

  it.each([
    [`'view-product'`, 'view-product'],
    [`"search.products"`, 'search.products'],
    ['123', '123'],
  ])('scans a tool keyed by %s', (key, name) => {
    const [finding] = scan(`
      ${key}: {
        description: 'Open the product page',
        execute: view,
      }
    `).filter((f) => f.code === 'unconditional-tool')
    expect(finding!.message).toContain(name)
  })

  it('accepts a when written as a method', () => {
    expect(
      codes(`
        checkout: {
          description: 'Place the order',
          execute: placeOrder,
          when() {
            return cart.items.length > 0
          },
        }
      `),
    ).not.toContain('unconditional-tool')
  })

  it('does not count a nested input property named when', () => {
    expect(
      codes(`
        checkout: {
          description: 'Place the order',
          execute: placeOrder,
          input: {
            properties: { when: { type: 'string' } },
            type: 'object',
          },
        }
      `),
    ).toContain('unconditional-tool')
  })

  it('ignores metadata that is commented out inside a real tool', () => {
    expect(
      codes(`
        checkout: {
          description: 'Place the order',
          execute: placeOrder,
          // title: 'Delete account',
          when: () => true,
        }
      `),
    ).toEqual([])
  })

  it('flags navigation assigned from a variable', () => {
    expect(
      codes(`
        view_product: {
          description: 'Open the product page',
          execute: () => {
            window.location = url
            return 'Opening'
          },
          when: () => true,
        }
      `),
    ).toContain('navigate-in-handler')
  })
  it('ignores an exposedTo origin that is commented out', () => {
    expect(
      codes(`
        share: {
          description: 'Share the current basket',
          execute: share,
          exposedTo: [
            'https://trusted.example',
            // 'http://old.example',
            /* 'http://older.example' */
          ],
          when: () => true,
        }
      `),
    ).toEqual([])
  })

  it('reads a tool written with shorthand properties', () => {
    const [finding] = scan(`
      const checkout = { description, execute }
    `).filter((f) => f.code === 'unconditional-tool')
    expect(finding!.message).toContain('checkout')
  })

  it('does not read an unrelated property named location as navigation', () => {
    expect(
      codes(`
        move_stock: {
          description: 'Move stock to another warehouse',
          execute: () => {
            settings.location = warehouse
            return 'Moved'
          },
          when: () => true,
        }
      `),
    ).not.toContain('navigate-in-handler')
  })

  it('flags a reload, which unloads the document just as surely', () => {
    expect(
      codes(`
        refresh: {
          description: 'Reload the current page',
          execute: () => {
            window.location.reload()
            return 'Reloading'
          },
          when: () => true,
        }
      `),
    ).toContain('navigate-in-handler')
  })

  it('reads a double-quoted title containing an apostrophe', () => {
    const [finding] = scan(`
      checkout: {
        description: 'Place the order',
        execute: placeOrder,
        title: "Delete the user's account",
        when: () => true,
      }
    `).filter((f) => f.code === 'label-mismatch')
    expect(finding!.message).toContain("Delete the user's account")
  })
  it('flags a description interpolated across two lines', () => {
    const [finding] = scan([
      '  description: `Search results',
      '${query}`,',
    ].join('\n')).filter((f) => f.code === 'dynamic-description')
    expect(finding!.severity).toBe('error')
  })

  it('reads a literal whose delimiter is escaped inside it', () => {
    const [finding] = scan(`
      checkout: {
        description: 'Place the order',
        execute: placeOrder,
        title: "Delete the user \\"account\\"",
        when: () => true,
      }
    `).filter((f) => f.code === 'label-mismatch')
    expect(finding!.message).toContain('account')
  })

  it('does not match location inside a longer identifier', () => {
    expect(
      codes(`
        preview: {
          description: 'Preview the order in another frame',
          execute: () => {
            previewwindow.location = url
            return 'Previewed'
          },
          when: () => true,
        }
      `),
    ).not.toContain('navigate-in-handler')
  })
})
