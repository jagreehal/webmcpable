import { expect, test } from 'vitest'
import { esc } from './panel'

// The panel interpolates tool input into a single-quoted attribute, and that
// input comes from the agent. A bare quote there is an attribute breakout.
test('esc neutralises attribute breakout', () => {
  expect(esc(`' onfocus='alert(1)`)).toBe('&#39; onfocus=&#39;alert(1)')
  expect(esc('" onfocus="alert(1)')).toBe('&quot; onfocus=&quot;alert(1)')
  expect(esc('<script>&')).toBe('&lt;script&gt;&amp;')
})
