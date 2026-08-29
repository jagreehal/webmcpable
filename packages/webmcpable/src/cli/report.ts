import type { DoctorReport } from './doctor'

// Built from a char code so the source file stays free of control bytes.
const ESC = String.fromCharCode(27)
const sgr = (n: string) => `${ESC}[${n}m`
const RESET = sgr('0')
const DIM = sgr('2')
const RED = sgr('31')
const YELLOW = sgr('33')
const GREEN = sgr('32')
const BOLD = sgr('1')

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

/** Human-readable report. `file:line:column` is clickable in most terminals. */
export function formatReport(report: DoctorReport, root: string, color = true): string {
  const c = (code: string, text: string) => (color ? `${code}${text}${RESET}` : text)

  if (report.findings.length === 0) {
    return c(GREEN, `no WebMCP drift in ${plural(report.filesScanned, 'file')}`)
  }

  const byFile = new Map<string, Array<DoctorReport['findings'][number]>>()
  for (const finding of report.findings) {
    const group = byFile.get(finding.file)
    if (group) {
      group.push(finding)
    } else {
      byFile.set(finding.file, [finding])
    }
  }

  const lines: Array<string> = []
  for (const [file, findings] of byFile) {
    lines.push(c(BOLD, file.startsWith(root) ? file.slice(root.length + 1) : file))
    for (const f of findings) {
      const label = f.severity === 'error' ? c(RED, 'error') : c(YELLOW, 'warning')
      lines.push(`  ${c(DIM, `${f.line}:${f.column}`)}  ${label}  ${f.message}`, `  ${c(DIM, `        -> ${f.fix}  [${f.code}]`)}`)
    }
    lines.push('')
  }

  const errors = report.findings.filter((f) => f.severity === 'error').length
  const warnings = report.findings.length - errors
  const parts = [
    errors ? c(RED, plural(errors, 'error')) : '',
    warnings ? c(YELLOW, plural(warnings, 'warning')) : '',
  ].filter(Boolean)
  lines.push(`${parts.join(', ')} in ${plural(report.filesScanned, 'file')}`)
  return lines.join('\n')
}
