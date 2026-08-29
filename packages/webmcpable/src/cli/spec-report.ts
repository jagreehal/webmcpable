import type { SpecReport } from './spec-check'

const ESC = String.fromCharCode(27)
const sgr = (n: string) => `${ESC}[${n}m`
const RESET = sgr('0')
const RED = sgr('31')
const GREEN = sgr('32')
const DIM = sgr('2')

export function formatSpecReport(report: SpecReport, color = true): string {
  const c = (code: string, text: string) => (color ? `${code}${text}${RESET}` : text)

  if (report.drift.length === 0) {
    return c(GREEN, `WebIDL matches the draft (${report.blocks} blocks)`)
  }

  const lines = [c(RED, 'The WebMCP draft has changed since this snapshot was pinned.'), '']
  for (const block of report.drift) {
    lines.push(c(DIM, `IDL block ${block.block}`))
    for (const line of block.removed) {lines.push(c(RED, `  - ${line}`))}
    for (const line of block.added) {lines.push(c(GREEN, `  + ${line}`))}
    lines.push('')
  }
  lines.push(c(DIM, `source: ${report.url}`), 'Review the change, update the code, then re-pin with `webmcpable spec-pin`.')
  return lines.join('\n')
}
