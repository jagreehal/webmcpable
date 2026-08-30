import { readdir, readFile } from 'node:fs/promises'
import { extname, join } from 'node:path'
import { scanSource, type Finding } from './rules'

export class ReadFailure extends Error {
  readonly _tag = 'ReadFailure'
  readonly path: string

  constructor(path: string, options?: { cause?: unknown }) {
    super(`cannot read ${path}`, options)
    this.name = 'ReadFailure'
    this.path = path
  }
}

const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.mts', '.cts'])
const SKIP_DIRECTORIES = new Set([
  'node_modules',
  'dist',
  'build',
  'coverage',
  '.git',
  '.next',
  '__tests__',
])

/**
 * Tests deliberately contain the patterns we flag, and they never reach an
 * agent. Scanning them produces noise that gets the whole tool switched off.
 */
const TEST_FILE = /\.(test|spec)\.[cm]?[jt]sx?$/

/**
 * Every source file under `root`, depth-first, skipping build output.
 *
 * `withFileTypes` classifies each entry without following symlinks, so a
 * symlinked directory reads as a plain entry and cannot produce a walk cycle.
 */
export async function collectSourceFiles(root: string): Promise<Array<string>> {
  let entries
  try {
    entries = await readdir(root, { withFileTypes: true })
  } catch (error) {
    throw new ReadFailure(root, { cause: error })
  }

  const files: Array<string> = []
  for (const entry of entries) {
    const full = join(root, entry.name)

    if (entry.isDirectory()) {
      if (!SKIP_DIRECTORIES.has(entry.name)) {
        files.push(...(await collectSourceFiles(full)))
      }
      continue
    }

    if (TEST_FILE.test(entry.name)) {continue}
    if (SOURCE_EXTENSIONS.has(extname(entry.name))) {files.push(full)}
  }

  return files
}

/** Scan one file. Exposed separately so editors can lint a single buffer. */
export async function scanFile(file: string): Promise<Array<Finding>> {
  try {
    return scanSource(file, await readFile(file, 'utf8'))
  } catch (error) {
    throw new ReadFailure(file, { cause: error })
  }
}

export interface DoctorReport {
  readonly filesScanned: number
  readonly findings: ReadonlyArray<Finding>
}

export async function doctor(root: string): Promise<DoctorReport> {
  const files = await collectSourceFiles(root)
  const findings: Array<Finding> = []

  // Sequential reads. Scanning is regex-bound, and a bounded pool
  // only pays off past a few thousand files. Add one if a large repo drags.
  for (const file of files) {
    findings.push(...(await scanFile(file)))
  }

  return { filesScanned: files.length, findings }
}

/** Exit code: 1 when anything is an error, so CI fails on drift. */
export const exitCodeFor = (report: DoctorReport): number =>
  report.findings.some((f) => f.severity === 'error') ? 1 : 0
