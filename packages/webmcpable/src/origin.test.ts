import { describe, expect, it } from 'vitest'
import { isPotentiallyTrustworthyOrigin } from './origin'

// W3C Secure Contexts: the whole 127.0.0.0/8 range and ::1/128 are loopback,
// and `URL` hands IPv6 back bracketed.
describe('isPotentiallyTrustworthyOrigin', () => {
  it.each([
    'https://example.com',
    'wss://example.com',
    'http://localhost',
    'http://localhost:5173',
    'http://app.localhost',
    'http://127.0.0.1',
    'http://127.0.0.2:8080',
    'http://127.255.255.254',
    'http://[::1]',
    'http://[::1]:5173',
    'file://',
  ])('accepts %s', (origin) => {
    expect(isPotentiallyTrustworthyOrigin(origin)).toBe(true)
  })

  it.each([
    'http://example.com',
    'http://partner.example',
    '*',
    '',
    'https://example.com/path',
    'http://127.evil.com',
    'http://1270.0.0.1',
    'http://128.0.0.1',
    'http://[::2]',
  ])('rejects %s', (origin) => {
    expect(isPotentiallyTrustworthyOrigin(origin)).toBe(false)
  })
})
