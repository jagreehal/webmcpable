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

export interface CallRecord {
  error?: string | undefined
  input: string
  name: string
  result?: string | undefined
}

export interface ReportEnvironment {
  calls?: ReadonlyArray<CallRecord>
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

  if (env.calls && env.calls.length > 0) {
    lines.push('## calls', '')
    for (const call of env.calls) {
      const outcome = call.result ?? call.error ?? ''
      lines.push(`- \`${call.name}\` \`${call.input}\` → ${outcome}`)
    }
    lines.push('')
  }

  for (const row of rows) {
    const annotations = row.tool.annotations ?? {}
    lines.push(`### ${row.tool.name}`, '', `- description: ${row.tool.description ?? '(none)'}`, `- title: ${
        row.tool.title ? row.tool.title : '(none)'
      }`, `- annotations kept: ${
        Object.keys(annotations).length > 0 ? `\`${JSON.stringify(annotations)}\`` : 'none'
      }`, ...row.findings.map(finding))
    if (row.lastInput !== undefined) {lines.push(`- input: \`${row.lastInput}\``)}
    if (row.lastResult !== undefined) {lines.push(`- agent receives: \`${row.lastResult}\``)}
    if (row.lastError !== undefined) {lines.push(`- **rejected**: ${row.lastError}`)}
    lines.push(...(row.resultFindings ?? []).map(finding), '')
  }

  return lines.join('\n')
}
