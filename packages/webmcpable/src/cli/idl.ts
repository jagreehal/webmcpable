/**
 * Extract and compare the WebIDL in the WebMCP draft.
 *
 * The draft is live and moving — `navigator.modelContext` became
 * `document.modelContext` this year, and two of the three existing WebMCP
 * libraries still have not noticed. Pinning the IDL and failing CI when it
 * changes turns "we track the spec" from a claim into something enforced.
 */

export interface IdlDrift {
  added: Array<string>
  /** Index of the IDL block, in source order. */
  block: number
  removed: Array<string>
}

// Bikeshed marks normative IDL as <xmp class="idl">; JavaScript examples use
// class=language-js and must not be mistaken for spec surface.
const IDL_BLOCK = /<xmp\s+class=(?:"idl"|'idl'|idl)\s*>([\s\S]*?)<\/xmp>/g

/** Collapse formatting so a reflow is not reported as a specification change. */
const normalise = (block: string): string =>
  block
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .join('\n')

export function extractIdl(source: string): Array<string> {
  const blocks: Array<string> = []
  IDL_BLOCK.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = IDL_BLOCK.exec(source)) !== null) {
    blocks.push(normalise(match[1] ?? ''))
  }
  return blocks
}

export function diffIdl(before: ReadonlyArray<string>, after: ReadonlyArray<string>): Array<IdlDrift> {
  const drift: Array<IdlDrift> = []
  const count = Math.max(before.length, after.length)

  for (let block = 0; block < count; block++) {
    const oldLines = (before[block] ?? '').split('\n').filter(Boolean)
    const newLines = (after[block] ?? '').split('\n').filter(Boolean)

    const oldSet = new Set(oldLines)
    const newSet = new Set(newLines)
    const added = newLines.filter((line) => !oldSet.has(line))
    const removed = oldLines.filter((line) => !newSet.has(line))

    if (added.length > 0 || removed.length > 0) {drift.push({ added, block, removed })}
  }

  return drift
}
