import { isPotentiallyTrustworthyOrigin } from '../origin'
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
  {
    code: 'chained-execute',
    fix: 'Do not call executeTool from a handler. Approving one tool is not approval of the next.',
    message: () =>
      'Calling executeTool from the page starts a second tool. Consent is not transitive — the user approved the first call, not this one.',
    pattern: /\.executeTool\s*\(/g,
    severity: 'warning',
  },
]

/** Opt out of a single line. */
const IGNORE_COMMENT = 'webmcpable-ignore'

/**
 * Blank out string literals and comments, preserving length so every offset
 * still points at the original source. Without this the scanner flags its own
 * rule table, any doc that merely *mentions* a pattern, and — worse — code
 * someone commented out, which can fail a build over a tool that is not there.
 *
 * A character scanner, not a parser. It knows the three things that would
 * otherwise corrupt everything after them: a regex literal can hold an
 * apostrophe, a quoted string cannot cross a newline, and a template literal
 * can.
 */
/** A `/` in a value position opens a regex literal; anywhere else it divides. */
const OPENS_REGEX = new Set('({[,;:!&|?+-*%=<>~^')

function opensRegex(out: Array<string>, at: number): boolean {
  let i = at - 1
  while (i >= 0 && /\s/.test(out[i]!)) {i--}
  if (i < 0) {return true}
  if (OPENS_REGEX.has(out[i]!)) {return true}
  const word = out.slice(Math.max(0, i - 6), i + 1).join('')
  return /\b(?:return|typeof|case)$/.test(word)
}

/** The end of the regex literal that opens at `start`, or the end of the line. */
function closingSlash(source: string, start: number): number {
  let escaped = false
  let inClass = false
  for (let i = start + 1; i < source.length; i++) {
    const char = source[i]!
    if (char === '\n') {return i - 1}
    if (escaped) {escaped = false; continue}
    if (char === '\\') {escaped = true; continue}
    if (char === '[') {inClass = true; continue}
    if (char === ']') {inClass = false; continue}
    if (char === '/' && !inClass) {return i}
  }
  return source.length - 1
}

export function mask(source: string, keep?: 'strings'): string {
  const out = source.split('')
  let quote: string | null = null
  let block = false
  let lineComment = false

  for (let i = 0; i < source.length; i++) {
    const char = source[i]!

    // Newlines survive, so line and column numbers stay true. Only a line
    // comment ends here; a block comment carries on.
    if (char === '\n' && !quote) {
      lineComment = false
      continue
    }

    if (lineComment) {
      out[i] = ' '
      continue
    }

    if (block) {
      out[i] = ' '
      if (char === '*' && source[i + 1] === '/') {
        out[i + 1] = ' '
        i++
        block = false
      }
      continue
    }

    if (quote) {
      // Only a template literal survives a newline. Treating an unterminated
      // apostrophe as a string to the end of the file is how one contraction
      // used to hide every tool below it.
      if (char === '\n') {
        if (quote !== '`') {quote = null}
        continue
      }
      if (char === '\\') {
        if (keep !== 'strings') {
          out[i] = ' '
          // A line continuation escapes the newline itself, which must survive.
          if (i + 1 < source.length && source[i + 1] !== '\n') {out[i + 1] = ' '}
        }
        i++
        continue
      }
      if (keep !== 'strings') {out[i] = ' '}
      if (char === quote) {quote = null}
      continue
    }

    if (char === "'" || char === '"' || char === '`') {
      quote = char
      if (keep !== 'strings') {out[i] = ' '}
      continue
    }
    if (char === '/' && source[i + 1] === '/') {
      lineComment = true
      out[i] = ' '
      continue
    }
    if (char === '/' && source[i + 1] === '*') {
      block = true
      out[i] = ' '
      continue
    }
    // `/don't/` is a regex, not the start of a string. Only a `/` in a value
    // position opens one — after an operator, a comma, or an opening bracket —
    // which is what separates it from division.
    if (char === '/' && opensRegex(out, i)) {
      const end = closingSlash(source, i)
      for (let j = i; j <= end; j++) {out[j] = ' '}
      i = end
      continue
    }
  }

  return out.join('')
}

const fold = (value: string) => value.toLowerCase().replaceAll(/[^a-z0-9]/g, '')

const lineColumn = (source: string, index: number): { column: number; line: number } => {
  const line = source.slice(0, index).split('\n').length
  const lineStart = source.lastIndexOf('\n', index - 1) + 1
  return { column: index - lineStart + 1, line }
}

/** The offset of the `}` closing the block that opens at `open`. */
const closingBrace = (source: string, open: number): number | undefined => {
  let depth = 0
  let quote: string | null = null
  for (let i = open; i < source.length; i++) {
    const char = source[i]!
    if (quote) {
      // Only a template literal survives a newline. Treating an unterminated
      // apostrophe as a string to the end of the file is how one contraction
      // used to hide every tool below it.
      if (char === '\n') {
        if (quote !== '`') {quote = null}
        continue
      }
      if (char === '\\') {i++; continue}
      if (char === quote) {quote = null}
      continue
    }
    if (char === '"' || char === "'" || char === '`') {quote = char; continue}
    if (char === '{') {depth++}
    else if (char === '}') {
      depth--
      if (depth === 0) {return i}
    }
  }
}

/**
 * Where a tool definition starts: keyed by name the way `tools()` takes them —
 * quoted or not — assigned to a variable, or handed straight to `registerTool`.
 * Each pattern ends at the `{` that opens the body.
 */
const TOOL_OPENINGS = [
  /(?:(['"])([\w.$-]+)\1|([A-Za-z_$][\w.$]*|\d+))\s*:\s*\{/g,
  /([A-Za-z_$][\w.$]*)\s*=\s*\{/g,
  /registerTool\s*\(\s*\{/g,
]

/** Character budgets from the Chrome team's "Build secure WebMCP tools". */
const BUDGET_NAME = 30
const BUDGET_DESCRIPTION = 500

/**
 * Every way a page hands the document over. A variable on the right navigates
 * as surely as a literal does, a reload unloads just as surely as a new URL,
 * and `settings.location` is somebody else's property.
 */
const LOCATION = String.raw`(?<![.\w])(?:(?:window|document|self|top|parent|globalThis)\s*\.\s*location|(?<!\b(?:const|let|var)\s{1,8})(?<![.\w])location)`
const NAVIGATES = new RegExp(
  `${LOCATION}\\s*(?:=(?!=)|\\.\\s*href\\s*=(?!=)|\\.\\s*(?:assign|replace|reload)\\s*\\()`,
)
const DEFERRED = /\b(?:setTimeout|setInterval|queueMicrotask|requestAnimationFrame)\s*\(/

/** A property or method written directly on this object. */
interface Member {
  method: boolean
  /** The raw text of the value, so a string literal can still be read. */
  value: string
}

/** A key at the top level of an object: bare, quoted, or numeric. */
const KEY = /(['"])([\w.$-]+)\1|([A-Za-z_$][\w$]*)|(\d+)/y

/**
 * The object's own members, ignoring everything nested inside them.
 *
 * Depth comes from the masked copy, so a `when` in an input schema is not the
 * availability predicate and a commented-out `title:` is not a title. Values
 * are read from the raw copy at the same offsets, because that is the only one
 * that still has the strings in it.
 */
function topLevelMembers(masked: string, raw: string): Map<string, Member> {
  const members = new Map<string, Member>()
  let depth = 0
  let open: { key: string; start: number } | undefined

  const close = (end: number) => {
    if (open) {
      members.set(open.key, { method: false, value: raw.slice(open.start, end).trim() })
      open = undefined
    }
  }

  for (let i = 0; i < masked.length; i++) {
    const char = masked[i]!
    if (char === '{' || char === '[' || char === '(') {depth++; continue}
    if (char === '}' || char === ']' || char === ')') {depth--; continue}
    if (depth > 0) {continue}
    if (char === ',') {close(i); continue}
    if (open) {continue}

    // A quoted key is blanked in the masked copy, so the raw quote is the only
    // signal it is there at all. Anything else masked here is a comment.
    const quoted = char === ' ' && (raw[i] === "'" || raw[i] === '"')
    if (!quoted && char !== raw[i]) {continue}
    if (/\s/.test(char)) {continue}

    KEY.lastIndex = i
    const match = KEY.exec(raw)
    if (!match) {continue}
    let after = i + match[0].length
    while (after < raw.length && /\s/.test(raw[after]!)) {after++}

    const key = match[2] ?? match[3] ?? match[4]!
    if (raw[after] === ':') {
      open = { key, start: after + 1 }
    } else if (raw[after] === '(') {
      members.set(key, { method: true, value: '' })
    } else if (raw[after] === undefined || raw[after] === ',') {
      // `{ description, execute }` — shorthand, so the value is a variable of
      // the same name and there is nothing here to read.
      members.set(key, { method: false, value: '' })
    }
    i = after - 1
  }
  close(masked.length)

  return members
}

/**
 * The text of a single string literal, or undefined when the value is anything
 * else. A double-quoted string may hold an apostrophe; a concatenation of two
 * strings holds its own delimiter, and is not a literal.
 */
function literal(value: string | undefined): string | undefined {
  const match = /^(['"`])([\s\S]*)\1$/.exec(value?.trim() ?? '')
  if (!match) {return undefined}
  const [, delimiter, inner] = match
  // An escaped delimiter is part of the text. A bare one means this was never
  // a single literal — `'a' + 'b'` is two of them.
  if (inner!.replaceAll(/\\[\s\S]/g, '').includes(delimiter!)) {return undefined}
  return inner!.replaceAll(/\\(['"`\\])/g, '$1')
}

/**
 * Tool objects span lines, so the per-line rules cannot see a name next to
 * its title or tell a `when` predicate from its absence.
 */
function scanToolObjects(
  file: string,
  source: string,
  masked: string,
  text: string,
): Array<Finding> {
  const findings: Array<Finding> = []
  const seen = new Set<number>()

  for (const pattern of TOOL_OPENINGS) {
    pattern.lastIndex = 0
    let match: RegExpExecArray | null
    while ((match = pattern.exec(text)) !== null) {
      const lineStart = source.lastIndexOf('\n', match.index) + 1
      const lineEnd = source.indexOf('\n', match.index)
      const rawLine = source.slice(lineStart, lineEnd === -1 ? source.length : lineEnd)
      if (rawLine.includes(IGNORE_COMMENT)) {continue}

      const open = match.index + match[0].length - 1
      if (seen.has(open)) {continue}
      // Openings are matched in the copy that still has strings in it, because
      // a quoted key exists nowhere else. The brace is what says this is live
      // code: inside a comment or a string it has been masked away.
      if (masked[open] !== '{') {continue}
      seen.add(open)
      const close = closingBrace(masked, open)
      if (close === undefined) {continue}
      const body = masked.slice(open + 1, close)
      // Values come from the copy with comments stripped and strings kept, so
      // a commented-out origin in an `exposedTo` list is not one of its origins.
      const members = topLevelMembers(body, text.slice(open + 1, close))

      if (!members.has('description')) {continue}
      // `execute:` and `execute() {}` are the same tool. Only the punctuation moved.
      if (!members.has('execute') && !members.has('handler')) {continue}

      // `registerTool({ name: 'checkout' })` and `const checkoutTool = { name:
      // 'checkout' }` both carry the real name inside; a webmcpable definition
      // is keyed by it.
      const name = literal(members.get('name')?.value) ?? match[2] ?? match[3] ?? match[1]
      if (!name) {continue}

      const { column, line } = lineColumn(source, match.index)
      const report = (finding: Omit<Finding, 'column' | 'file' | 'line'>) =>
        findings.push({ ...finding, column, file, line })

      if (members.has('outputSchema')) {
        report({
          code: 'output-schema',
          fix: 'Say what the result looks like in the description — that is the only channel the agent reads.',
          message: `"${name}" declares an outputSchema, which is not in the WebMCP draft and is dropped at registration.`,
          severity: 'error',
        })
      }

      const title = literal(members.get('title')?.value)
      if (title && !fold(title).includes(fold(name))) {
        report({
          code: 'label-mismatch',
          fix: 'Omit `title`, keep it equal to the tool name, or pass `{ titles: "off" }`.',
          message: `"${name}" has title "${title}", which a consent dialogue may show instead of the name.`,
          severity: 'warning',
        })
      }

      if (name.length > BUDGET_NAME) {
        report({
          code: 'over-budget-name',
          fix: 'Shorten the name. The description carries the detail.',
          message: `"${name}" is ${name.length} characters. The recommended budget is ${BUDGET_NAME}.`,
          severity: 'warning',
        })
      }

      // A description built by concatenation is measured by the debug panel at
      // runtime instead; only a single literal can be counted here.
      const described = literal(members.get('description')?.value)
      if (described && described.length > BUDGET_DESCRIPTION) {
        report({
          code: 'over-budget-description',
          fix: 'Say what it does and when to use it. Per-call detail belongs in the input schema.',
          message: `"${name}" has a ${described.length}-character description. The recommended budget is ${BUDGET_DESCRIPTION}.`,
          severity: 'warning',
        })
      }

      const exposed = members.get('exposedTo')?.value ?? ''
      for (const [, , origin] of exposed.matchAll(/(['"`])([^'"`]*)\1/g)) {
        if (!isPotentiallyTrustworthyOrigin(origin!)) {
          report({
            code: 'untrusted-origin',
            fix: 'List exact https origins. There is no wildcard, and the browser refuses anything not potentially trustworthy.',
            message: `"${name}" is exposed to "${origin}", which is not a potentially trustworthy origin.`,
            severity: 'error',
          })
        }
      }

      // A tool that navigates unloads the document that owes the agent a
      // result. This is a body-wide check, so a deferral anywhere in the tool
      // clears it; telling apart the safe order from the unsafe one needs a
      // parser.
      if (NAVIGATES.test(body) && !DEFERRED.test(body)) {
        report({
          code: 'navigate-in-handler',
          fix: 'Return the result first, then navigate from a task: `setTimeout(() => location.assign(url), 0)`.',
          message: `"${name}" navigates while the agent is still waiting for its result. Measured in Chrome 152: a value returned synchronously survives, anything awaited after the navigation is lost.`,
          severity: 'warning',
        })
      }

      if (!members.has('when') && !/\breadOnlyHint\s*:\s*true/.test(body)) {
        report({
          code: 'unconditional-tool',
          fix: 'Add a `when` predicate, or mark the tool `readOnlyHint: true` if it cannot change user state.',
          message: `"${name}" is always offered and has no \`when\` predicate — a loaded gun with no safety.`,
          severity: 'warning',
        })
      }
    }
  }

  return findings
}

export function scanSource(file: string, source: string): Array<Finding> {
  const findings: Array<Finding> = []
  const masked = mask(source)
  const text = mask(source, 'strings')
  const maskedLines = masked.split('\n')
  const sourceLines = source.split('\n')

  sourceLines.forEach((raw, index) => {
    if (raw.includes(IGNORE_COMMENT)) {return}
    const line = maskedLines[index] ?? ''
    for (const rule of RULES) {
      if (rule.raw) {continue}
      rule.pattern.lastIndex = 0
      let match: RegExpExecArray | null
      while ((match = rule.pattern.exec(line)) !== null) {
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

  // A raw rule reads the unmasked source, because masking removes the very
  // template literal it looks for — and a template literal spans as many lines
  // as it likes, so these are matched against the whole file at once. The
  // masked copy at the same offset is how they still tell code from a comment.
  for (const rule of RULES) {
    if (!rule.raw) {continue}
    rule.pattern.lastIndex = 0
    let match: RegExpExecArray | null
    while ((match = rule.pattern.exec(source)) !== null) {
      if (masked[match.index] !== source[match.index]) {continue}
      const { column, line } = lineColumn(source, match.index)
      if (sourceLines[line - 1]?.includes(IGNORE_COMMENT)) {continue}
      findings.push({
        code: rule.code,
        column,
        file,
        fix: rule.fix,
        line,
        message: rule.message(match),
        severity: rule.severity,
      })
    }
  }

  return [...findings, ...scanToolObjects(file, source, masked, text)]
}

export const ruleCodes = (): Array<string> => RULES.map((r) => r.code)
