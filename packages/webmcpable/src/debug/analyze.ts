/**
 * Runtime checks on what an agent actually sees.
 *
 * Every rule is grounded in measured Chrome behaviour (spike/SPIKE-FINDINGS.md) or
 * the W3C draft — not style preference.
 */

export interface Finding {
  code: string
  /** What to do about it. Optional so existing findings stay valid. */
  fix?: string
  message: string
  severity: 'error' | 'warning'
}

/** The two annotations the draft defines. Everything else is invented. */
const KNOWN_ANNOTATIONS = new Set(['readOnlyHint', 'untrustedContentHint'])

/** Spec: 1-128 chars, ASCII alphanumeric, '_', '-' or '.'. */
const VALID_NAME = /^[A-Za-z0-9_.-]{1,128}$/

/** Long enough that an agent can tell this tool apart from its neighbours. */
const MIN_DESCRIPTION = 15

/**
 * A description is context an agent reads, not a contract it can verify — the
 * WebMCP draft says as much (no guarantee a tool's declared intent matches its
 * behaviour). Anything phrased as an order to the agent is a poisoning vector,
 * and in a good-faith app it is almost always user content that reached a
 * description through a template literal.
 */
const AGENT_INSTRUCTIONS: Array<[RegExp, Finding['severity']]> = [
  [/\bignore\s+(all\s+)?(previous|prior|above)\b/i, 'error'],
  [/\b(system prompt|previous instructions)\b/i, 'error'],
  [/\bdo not\s+(tell|inform|mention|ask)\b/i, 'error'],
  [/\b(also|then|afterwards?|next)\s+(call|invoke|run|use)\b/i, 'warning'],
]

export interface InspectedTool {
  annotations?: Record<string, unknown>
  description?: string
  /** Chrome's listTools() hands this back as a JSON string. */
  inputSchema?: unknown
  name: string
}

const parseSchema = (schema: unknown): Record<string, unknown> | undefined => {
  if (typeof schema === 'string') {
    try {
      return JSON.parse(schema) as Record<string, unknown>
    } catch {
      return undefined
    }
  }
  return typeof schema === 'object' && schema !== null ? (schema as Record<string, unknown>) : undefined
}

export function analyzeResult(result: string): Array<Finding> {
  const findings: Array<Finding> = []

  if (result === '') {
    findings.push({
      code: 'empty-result',
      message: 'The tool returned nothing. The agent has no idea whether it worked.',
      severity: 'warning',
    })
    return findings
  }

  if (result === 'undefined') {
    findings.push({
      code: 'undefined-result',
      message:
        'The handler returned `undefined`, so the agent receives the literal text "undefined". Return a value describing what happened.',
      severity: 'error',
    })
    return findings
  }

  try {
    const parsed: unknown = JSON.parse(result)
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      Array.isArray((parsed as { content?: unknown }).content)
    ) {
      findings.push({
        code: 'mcp-envelope',
        message:
          'This is an MCP `{ content: [...] }` envelope. Chrome does not unwrap it, so the agent must parse JSON to reach your text. Return the plain value instead.',
        severity: 'error',
      })
    }
  } catch {
    // Not JSON — a plain string result, which is the good case.
  }

  return findings
}

export function analyzeTool(tool: InspectedTool): Array<Finding> {
  const findings: Array<Finding> = []

  if (!VALID_NAME.test(tool.name)) {
    findings.push({
      code: 'invalid-name',
      message: `"${tool.name}" is not a valid tool name. Use 1-128 characters: letters, digits, '_', '-' or '.'.`,
      severity: 'error',
    })
  }

  if (!tool.description || tool.description.trim().length < MIN_DESCRIPTION) {
    findings.push({
      code: 'thin-description',
      message: `"${tool.name}" has a description too short for an agent to choose it over another tool. Say what it does and when to use it.`,
      severity: 'warning',
    })
  }

  for (const key of Object.keys(tool.annotations ?? {})) {
    if (!KNOWN_ANNOTATIONS.has(key)) {
      findings.push({
        code: 'unknown-annotation',
        message: `\`${key}\` is not in the WebMCP draft and is silently ignored. Only readOnlyHint and untrustedContentHint exist.`,
        severity: 'error',
      })
    }
  }

  // Descriptions and parameter descriptions are the two places text an agent
  // treats as instruction can arrive without a user ever seeing it.
  const described: Array<string> = [tool.description ?? '']
  const schema = parseSchema(tool.inputSchema)
  for (const value of Object.values((schema?.['properties'] ?? {}) as Record<string, unknown>)) {
    const text = (value as { description?: unknown })?.description
    if (typeof text === 'string') {described.push(text)}
  }

  for (const [pattern, severity] of AGENT_INSTRUCTIONS) {
    const hit = described.find((text) => pattern.test(text))
    if (hit !== undefined) {
      findings.push({
        code: 'instruction-in-description',
        fix: 'Describe what the tool does. Never interpolate user content into a description — an agent reads it as instruction.',
        message: `"${tool.name}" has a description that reads as an instruction to the agent, not a description of the tool.`,
        severity,
      })
      break
    }
  }

  const properties = schema?.['properties']
  if (typeof properties === 'object' && properties !== null) {
    for (const [key, value] of Object.entries(properties as Record<string, unknown>)) {
      const described =
        typeof value === 'object' && value !== null && typeof (value as { description?: unknown }).description === 'string'
      if (!described) {
        findings.push({
          code: 'undescribed-parameter',
          message: `Parameter "${key}" has no description, so the agent has to guess what to put in it.`,
          severity: 'warning',
        })
      }
    }
  }

  return findings
}

/** The descriptor fields a user would have seen when they approved the tool. */
const DESCRIPTOR: Array<keyof InspectedTool> = ['description', 'inputSchema', 'annotations']

/**
 * A tool that changed under a name the agent has already been offered. The
 * browser reports a `toolchange` event but never says what moved, so a swap and
 * an ordinary update look identical unless someone keeps the previous copy.
 */
export function analyzeChange(before: InspectedTool, after: InspectedTool): Array<Finding> {
  const changed = DESCRIPTOR.filter(
    (field) => JSON.stringify(before[field]) !== JSON.stringify(after[field]),
  )
  if (changed.length === 0) {return []}

  return [
    {
      code: 'tool-redefined',
      fix: 'If this is intended, nothing is wrong. If it is not, register under a new name so the agent has to ask again.',
      message: `"${after.name}" changed its ${changed.join(', ')} after registration, under a name the agent already had.`,
      severity: 'warning',
    },
  ]
}
