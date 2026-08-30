import type { HTMLAttributes } from 'react'
import { describe, expect, it } from 'vitest'

// The declarative attributes are only useful if TypeScript accepts them where
// authors write them. Without `declarative.d.ts` this file does not compile,
// which is the assertion.
describe('declarative attributes', () => {
  it('type-checks on a form and its fields', () => {
    const form: HTMLAttributes<HTMLFormElement> = {
      toolautosubmit: true,
      tooldescription: 'Book a table for tonight',
      toolname: 'book_table',
    }
    const field: HTMLAttributes<HTMLInputElement> = {
      toolparamdescription: 'How many people are coming',
    }
    expect([form.toolname, field.toolparamdescription]).toEqual([
      'book_table',
      'How many people are coming',
    ])
  })
})
