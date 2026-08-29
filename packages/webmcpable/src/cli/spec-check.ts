import { readFile, writeFile } from 'node:fs/promises'
import { diffIdl, extractIdl, type IdlDrift } from './idl'

/**
 * `webmcpable spec-check` — compare the pinned WebIDL snapshot against the live
 * W3C draft and fail when they diverge.
 */

export class SpecFetchFailure extends Error {
  readonly _tag = 'SpecFetchFailure'
  readonly url: string

  constructor(url: string, options?: { cause?: unknown }) {
    super(`cannot fetch the draft at ${url}`, options)
    this.name = 'SpecFetchFailure'
    this.url = url
  }
}

export class SnapshotMissing extends Error {
  readonly _tag = 'SnapshotMissing'
  readonly path: string

  constructor(path: string, options?: { cause?: unknown }) {
    super(`no IDL snapshot at ${path}`, options)
    this.name = 'SnapshotMissing'
    this.path = path
  }
}

export const DRAFT_URL =
  'https://raw.githubusercontent.com/webmachinelearning/webmcp/main/index.bs'

export interface SpecReport {
  readonly blocks: number
  readonly drift: ReadonlyArray<IdlDrift>
  readonly url: string
}

/** The draft's IDL as it stands right now. */
export async function fetchDraftIdl(url: string = DRAFT_URL): Promise<Array<string>> {
  try {
    const response = await fetch(url)
    if (!response.ok) {throw new Error(`responded ${response.status}`)}
    return extractIdl(await response.text())
  } catch (error) {
    throw new SpecFetchFailure(url, { cause: error })
  }
}

export async function readSnapshot(path: string): Promise<Array<string>> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as Array<string>
  } catch (error) {
    throw new SnapshotMissing(path, { cause: error })
  }
}

export async function writeSnapshot(
  path: string,
  blocks: ReadonlyArray<string>,
): Promise<void> {
  await writeFile(path, `${JSON.stringify(blocks, null, 2)}\n`)
}

export async function specCheck(
  snapshotPath: string,
  url: string = DRAFT_URL,
): Promise<SpecReport> {
  // Fetch and read are independent; run them together.
  const [current, pinned] = await Promise.all([fetchDraftIdl(url), readSnapshot(snapshotPath)])

  return { blocks: current.length, drift: diffIdl(pinned, current), url }
}

/** Non-zero when the draft has moved, so CI fails on drift. */
export const exitCodeFor = (report: SpecReport): number => (report.drift.length > 0 ? 1 : 0)
