/**
 * Static checks for drift from the WebMCP draft and from Chrome's real
 * behaviour. Pure functions — no IO — so they are trivial to test and to run
 * over anything: a file, an editor buffer, a diff.
 *
 * Every rule cites a source: the W3C draft (webmachinelearning/webmcp) or a
 * measurement in webmcpable's spike/SPIKE-FINDINGS.md.
 */

export interface Finding {
  code: string
  column: number
  file: string
  fix: string
  line: number
  message: string
  severity: 'error' | 'warning'
}

interface Rule {
  code: string
  fix: string
  message: (match: RegExpExecArray) => string
  pattern: RegExp
  /**
   * Match the original line instead of the masked one. Only for rules that must
   * see inside a string literal — `mask()` blanks quotes and backticks alike,
   * so after masking a template literal is indistinguishable from a plain one.
   */
  raw?: true
  severity: Finding['severity']
}

/** Only these two exist in the draft; the rest are imported from server-side MCP. */
const INVENTED_ANNOTATIONS = [
  'destructiveHint',
  'idempotentHint',
  'openWorldHint',
  'confirmationHint',
  'safetyLevel',
]

const RULES: Array<Rule> = [
  {
    code: 'navigator-alias',
    fix: 'Use `document.modelContext`.',
    message: () =>
      '`navigator.modelContext` is not in the WebMCP draft. Chrome currently aliases it to `document.modelContext`, but that alias can be withdrawn at any time.',
    pattern: /\bnavigator\.modelContext\b(?!Testing)/g,
    severity: 'warning',
  },
  {
    code: 'no-unregister-tool',
    fix: 'Pass `{ signal }` to registerTool and abort the AbortSignal to unregister.',
    message: () => '`unregisterTool()` does not exist in the WebMCP draft.',
    pattern: /\.unregisterTool\s*\(/g,
    severity: 'error',
  },
  {
    code: 'unknown-annotation',
    fix: 'The draft defines only `readOnlyHint` and `untrustedContentHint`.',
    message: (m) =>
      `\`${m[1]}\` is not defined by the WebMCP draft and is silently ignored by the browser.`,
    pattern: new RegExp(`\\b(${INVENTED_ANNOTATIONS.join('|')})\\s*:`, 'g'),
    severity: 'error',
  },
  {
    code: 'execute-tool-object',
    fix: 'Pass `JSON.stringify(args)`.',
    message: () =>
      'Chrome requires input arguments as a JSON string and rejects objects with "Failed to parse input arguments".',
    pattern: /\.executeTool\s*\([^,)]+,\s*\{/g,
    severity: 'error',
  },
  {
    code: 'mcp-envelope',
    severity: 'warning',
    // String literals are masked before scanning, so match the shape,
    // not the quoted 'text' value.
    fix: 'Return the plain value from your handler.',
    message: () =>
      'Chrome does not unwrap MCP `{ content: [...] }` envelopes — the agent receives the wrapper as JSON and has to parse it.',
    pattern: /\bcontent\s*:\s*\[\s*\{\s*type\s*:/g,
  },
  {
    code: 'stringify-registered-tool',
    fix: 'Pick the fields you need explicitly.',
    message: () =>
      'A RegisteredTool carries an owner `window`, so JSON.stringify throws "Converting circular structure to JSON".',
    pattern: /JSON\.stringify\s*\(\s*(tools|registeredTools)\b/g,
    severity: 'warning',
  },
  {
    code: 'dynamic-description',
    fix: 'Keep the description a fixed string. Put the changing part in the input schema, where it is data rather than instruction.',
    message: () =>
      'A description built at runtime puts whatever it interpolates in front of the agent, as text the agent treats as instruction and the user never sees.',
    pattern: /\b(?:description|title)\s*:\s*`[^`]*\$\{/g,
    raw: true,
    severity: 'error',
  },
]

/** Opt out of a single line. */
const IGNORE_COMMENT = 'webmcpable-ignore'

/**
 * Blank out string literals and comments, preserving length so every column
 * number still points at the original source. Without this the scanner flags
 * its own rule table, and any test or doc that merely *mentions* a pattern.
 */
export function mask(line: string): string {
  const out = line.split('')
  let quote: string | null = null

  for (let i = 0; i < line.length; i++) {
    const char = line[i]!

    if (quote) {
      if (char === '\\') {
        out[i] = ' '
        if (i + 1 < line.length) {out[i + 1] = ' '}
        i++
        continue
      }
      out[i] = ' '
      if (char === quote) {quote = null}
      continue
    }

    if (char === "'" || char === '"' || char === '`') {
      quote = char
      out[i] = ' '
      continue
    }

    // A line comment ends the line; a block comment is blanked to its close.
    if (char === '/' && line[i + 1] === '/') {return out.slice(0, i).join('')}
    if (char === '/' && line[i + 1] === '*') {
      const end = line.indexOf('*/', i + 2)
      const stop = end === -1 ? line.length : end + 2
      for (let j = i; j < stop; j++) {out[j] = ' '}
      i = stop - 1
    }
  }

  return out.join('')
}

export function scanSource(file: string, source: string): Array<Finding> {
  const findings: Array<Finding> = []

  source.split('\n').forEach((raw, index) => {
    if (raw.includes(IGNORE_COMMENT)) {return}
    const line = mask(raw)
    for (const rule of RULES) {
      const target = rule.raw ? raw : line
      rule.pattern.lastIndex = 0
      let match: RegExpExecArray | null
      while ((match = rule.pattern.exec(target)) !== null) {
        findings.push({
          code: rule.code,
          column: match.index + 1,
          file,
          fix: rule.fix,
          line: index + 1,
          message: rule.message(match),
          severity: rule.severity,
        })
      }
    }
  })

  return findings
}

export const ruleCodes = (): Array<string> => RULES.map((r) => r.code)
