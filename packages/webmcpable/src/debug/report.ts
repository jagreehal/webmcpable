import type { Finding, InspectedTool } from './analyze'

/**
 * The Markdown report the panel copies to the clipboard.
 *
 * Kept as a pure function with its own tests because this is the feedback
 * loop: what it omits, nobody sees. It previously drifted from what the panel
 * rendered, and annotations went missing for two rounds of testing.
 */

export interface ReportRow {
  findings: Array<Finding>
  lastError?: string | undefined
  lastInput?: string | undefined
  lastResult?: string | undefined
  resultFindings?: Array<Finding> | undefined
  tool: InspectedTool
}

export interface ReportEnvironment {
  supported: boolean
  userAgent: string
}

const finding = (f: Finding) =>
  `- **${f.severity}** [${f.code}] ${f.message}${f.fix ? ` — ${f.fix}` : ''}`

export function buildReport(env: ReportEnvironment, rows: ReadonlyArray<ReportRow>): string {
  const lines = [
    '## webmcpable debug report',
    '',
    `- userAgent: \`${env.userAgent}\``,
    `- document.modelContext: ${env.supported ? 'present' : '**MISSING**'}`,
    `- tools registered: ${rows.length}`,
    '',
  ]

  for (const row of rows) {
    const annotations = row.tool.annotations ?? {}
    lines.push(`### ${row.tool.name}`, '', `- description: ${row.tool.description ?? '(none)'}`, `- annotations kept: ${
        Object.keys(annotations).length > 0 ? `\`${JSON.stringify(annotations)}\`` : 'none'
      }`, ...row.findings.map(finding))
    if (row.lastInput !== undefined) {lines.push(`- input: \`${row.lastInput}\``)}
    if (row.lastResult !== undefined) {lines.push(`- agent receives: \`${row.lastResult}\``)}
    if (row.lastError !== undefined) {lines.push(`- **rejected**: ${row.lastError}`)}
    lines.push(...(row.resultFindings ?? []).map(finding), '')
  }

  return lines.join('\n')
}
