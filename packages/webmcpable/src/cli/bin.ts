#!/usr/bin/env node
import { fileURLToPath } from 'node:url'
import { doctor, exitCodeFor } from './doctor'
import { formatReport } from './report'
import { formatSpecReport } from './spec-report'
import {
  DRAFT_URL,
  exitCodeFor as specExitCode,
  fetchDraftIdl,
  specCheck,
  writeSnapshot,
} from './spec-check'

const BUNDLED_SNAPSHOT = fileURLToPath(new URL('../webmcp-idl.snapshot.json', import.meta.url))
const LOCAL_SNAPSHOT = 'webmcp-idl.snapshot.json'

const USAGE = `webmcpable - find WebMCP hazards and draft changes

  webmcpable doctor [dir]     scan for known browser and draft hazards
  webmcpable spec-check       compare bundled and live draft WebIDL
  webmcpable spec-pin         re-pin the snapshot to the current draft

Returns exit code 1 for errors, so both commands work in CI.`

const out = (text: string) => process.stdout.write(`${text}\n`)

const main = async (): Promise<number> => {
  const [command, target] = process.argv.slice(2)
  const color = process.stdout.isTTY ?? false

  if (command === 'spec-pin') {
    const blocks = await fetchDraftIdl(DRAFT_URL)
    const path = target ?? LOCAL_SNAPSHOT
    await writeSnapshot(path, blocks)
    out(`pinned ${blocks.length} IDL blocks to ${path}`)
    return 0
  }

  if (command === 'spec-check') {
    const report = await specCheck(target ?? BUNDLED_SNAPSHOT, DRAFT_URL)
    out(formatSpecReport(report, color))
    return specExitCode(report)
  }

  if (command !== 'doctor') {
    out(USAGE)
    return command === undefined || command === '--help' ? 0 : 1
  }

  const root = target ?? process.cwd()
  const report = await doctor(root)
  out(formatReport(report, root, color))
  return exitCodeFor(report)
}

try {
  process.exitCode = await main()
} catch (error) {
  process.exitCode = 1
  const failure = error as { _tag?: string; message?: string }

  // Anything without a tag is a bug rather than a user error: rethrow so the
  // stack survives.
  if (failure._tag === 'SnapshotMissing') {
    process.stderr.write(`${failure.message}. Run \`webmcpable spec-pin\` to create one.\n`)
  } else if (failure._tag === 'ReadFailure' || failure._tag === 'SpecFetchFailure') {
    process.stderr.write(`${failure.message}\n`)
  } else {
    throw error
  }
}
