import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { doctor, exitCodeFor, ReadFailure } from './doctor'

const fixture = async (files: Record<string, string>) => {
  const root = await mkdtemp(join(tmpdir(), 'webmcpable-'))
  for (const [name, content] of Object.entries(files)) {
    const full = join(root, name)
    await mkdir(join(full, '..'), { recursive: true })
    await writeFile(full, content)
  }
  return root
}

describe('doctor', () => {
  it('finds drift across a directory tree', async () => {
    const dir = await fixture({
      'src/a.ts': 'navigator.modelContext.registerTool(t)',
      'src/nested/b.ts': 'document.modelContext.unregisterTool("x")',
    })

    const report = await doctor(dir)

    expect(report.filesScanned).toBe(2)
    expect(report.findings.map((f) => f.code).sort()).toEqual([
      'navigator-alias',
      'no-unregister-tool',
    ])
  })

  it('skips node_modules and build output', async () => {
    const dir = await fixture({
      'dist/bundle.js': 'navigator.modelContext.registerTool(t)',
      'node_modules/pkg/index.js': 'navigator.modelContext.registerTool(t)',
      'src/a.ts': 'const x = 1',
    })

    const report = await doctor(dir)

    expect(report.filesScanned).toBe(1)
    expect(report.findings).toEqual([])
  })

  it('ignores files that are not source', async () => {
    const dir = await fixture({
      'README.md': 'use navigator.modelContext for legacy browsers',
      'src/a.ts': 'const x = 1',
    })

    expect((await doctor(dir)).filesScanned).toBe(1)
  })

  it('exits non-zero only when something is an error', async () => {
    const warningOnly = await fixture({ 'a.ts': 'navigator.modelContext.getTools()' })
    const warned = await doctor(warningOnly)
    expect(warned.findings[0]!.severity).toBe('warning')
    expect(exitCodeFor(warned)).toBe(0)

    const withError = await fixture({ 'a.ts': 'annotations: { destructiveHint: true }' })
    expect(exitCodeFor(await doctor(withError))).toBe(1)
  })

  it('skips test files, which deliberately contain bad patterns', async () => {
    const dir = await fixture({
      'src/__tests__/c.ts': 'navigator.modelContext.getTools()',
      'src/a.test.ts': 'annotations: { destructiveHint: true }',
      'src/b.spec.tsx': 'navigator.modelContext.getTools()',
      'src/real.ts': 'const x = 1',
    })

    const report = await doctor(dir)
    expect(report.filesScanned).toBe(1)
    expect(report.findings).toEqual([])
  })

  it('fails with a ReadFailure naming the path that does not exist', async () => {
    await expect(doctor('/no/such/path')).rejects.toThrow(ReadFailure)
    await expect(doctor('/no/such/path')).rejects.toMatchObject({ path: '/no/such/path' })
  })
})
