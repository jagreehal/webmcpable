import { analyzeChange, analyzeResult, analyzeTool, type Finding, type InspectedTool } from './analyze'
import { exampleInput } from './example'
import { buildReport, type CallRecord, type ReportRow } from './report'

/**
 * A floating panel that shows what an agent sees, lets you invoke tools with
 * real arguments, and copies a Markdown report you can paste anywhere.
 *
 * Zero dependencies, no build step. `mountDebugPanel()` and reload.
 */

export interface DebugPanelOptions {
  /** Where to attach. Defaults to document.body. */
  container?: HTMLElement
  /** Start expanded. Defaults to true. */
  open?: boolean
}

type Row = ReportRow

const css = `
.webmcpable { position: fixed; right: 16px; bottom: 16px; width: 420px; max-height: 70vh;
  display: flex; flex-direction: column; z-index: 2147483647; background: #fff; color: #111;
  border: 1px solid #d0d0d0; border-radius: 10px; box-shadow: 0 8px 32px rgb(0 0 0 / .18);
  font: 12px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace }
.webmcpable header { display: flex; align-items: center; gap: 8px; padding: 8px 10px;
  border-bottom: 1px solid #eee; cursor: pointer; user-select: none }
.webmcpable header b { font-size: 12px; letter-spacing: .02em }
.webmcpable .grow { flex: 1 }
.webmcpable button { font: inherit; padding: 3px 8px; border: 1px solid #ccc; background: #fafafa;
  border-radius: 5px; cursor: pointer }
.webmcpable button:hover { background: #f0f0f0 }
.webmcpable .body { overflow-y: auto; padding: 6px 10px 10px }
.webmcpable .tool { border-top: 1px solid #f0f0f0; padding: 8px 0 }
.webmcpable .tool:first-child { border-top: 0 }
.webmcpable .name { font-weight: 600 }
.webmcpable .desc { color: #666 }
.webmcpable .f { margin: 4px 0; padding: 4px 6px; border-radius: 4px; border-left: 3px solid }
.webmcpable .fix { opacity: 0.75 }
.webmcpable .error { background: #fdf0f0; border-color: #d33 }
.webmcpable .warning { background: #fdf8e8; border-color: #d90 }
.webmcpable .ok { color: #070 }
.webmcpable input { font: inherit; width: 100%; padding: 3px 5px; border: 1px solid #ccc;
  border-radius: 4px; margin: 3px 0 }
.webmcpable pre { background: #f6f6f6; padding: 6px; border-radius: 4px; overflow-x: auto;
  white-space: pre-wrap; word-break: break-all; margin: 4px 0 }
.webmcpable .muted { color: #888 }
`

export const esc = (s: string) =>
  s.replaceAll(
    /[&<>"']/g,
    (c) => ({ "'": '&#39;', '"': '&quot;', '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!,
  )

export function mountDebugPanel(options: DebugPanelOptions = {}): { destroy(): void } {
  const host = document.createElement('div')
  host.className = 'webmcpable'
  const style = document.createElement('style')
  style.textContent = css

  let open = options.open ?? true
  let rows: Array<Row> = []
  const calls: Array<CallRecord> = []

  const supported = Boolean(document.modelContext)

  async function refresh() {
    if (!supported) {return render()}
    // getTools() is the richer source — RegisteredTool carries `annotations`,
    // which listTools() omits. Its results are circular (they hold an owner
    // `window`), so pick fields explicitly and never spread. listTools() fills
    // in an inputSchema when getTools() does not expose one.
    // Chrome 152 removed modelContextTesting and getTools() carries the schema,
    // so this only fills a gap on 151 and earlier.
    const listed = navigator.modelContextTesting?.listTools() ?? []
    const schemaByName = new Map(listed.map((t) => [t.name, t.inputSchema]))

    const tools: Array<InspectedTool> = (await document.modelContext!.getTools()).map((t) => {
      const registered = t as typeof t & { annotations?: Record<string, unknown>; title?: string }
      return {
        description: t.description,
        inputSchema: t.inputSchema ?? schemaByName.get(t.name),
        name: t.name,
        ...(registered.title ? { title: registered.title } : {}),
        ...(registered.annotations ? { annotations: registered.annotations } : {}),
      }
    })

    const previous = new Map(rows.map((r) => [r.tool.name, r]))
    rows = tools.map((tool) => {
      const before = previous.get(tool.name)
      return {
        ...before,
        // The browser fires `toolchange` without saying what moved, so the
        // previous descriptor is the only way to tell a swap from an update.
        findings: [
          ...analyzeTool(tool),
          ...(before ? analyzeChange(before.tool, tool) : []),
        ],
        tool,
        // Seed from the schema so the first Run is a real call, not a
        // validation error. An edit by hand survives a refresh.
        lastInput: before?.lastInput ?? exampleInput(tool.inputSchema),
      }
    })
    render()
  }

  async function run(row: Row, raw: string) {
    row.lastInput = raw
    row.lastError = undefined
    row.lastResult = undefined
    try {
      const tools = await document.modelContext!.getTools()
      const target = tools.find((t) => t.name === row.tool.name)
      if (!target) {throw new Error('tool is no longer registered')}
      // Chrome requires a JSON string here, never an object.
      const result = await document.modelContext!.executeTool(target, raw || '{}') // webmcpable-ignore
      row.lastResult = result
      row.resultFindings = analyzeResult(result)
    } catch (error) {
      row.lastError = error instanceof Error ? `${error.name}: ${error.message}` : String(error)
    }
    calls.push({
      input: raw,
      name: row.tool.name,
      ...(row.lastResult !== undefined && { result: row.lastResult }),
      ...(row.lastError !== undefined && { error: row.lastError }),
    })
    render()
  }

  const report = () =>
    buildReport({ calls, supported, userAgent: navigator.userAgent }, rows)

  function render() {
    const findingHtml = (f: Finding) =>
      `<div class="f ${f.severity}">${esc(f.message)}${
        f.fix ? `<br><span class="fix">${esc(f.fix)}</span>` : ''
      }</div>`

    const journal = calls.length === 0
      ? ''
      : `<div class="tool"><div class="muted">calls this session</div>${calls
          .map((call) => `<pre>${esc(call.name)} ${esc(call.input)} → ${esc(call.result ?? call.error ?? '')}</pre>`)
          .join('')}</div>`

    const body = !supported
      ? `<div class="f error">document.modelContext is missing. Enable WebMCP in this browser, or use webmcpable/testing in tests.</div>`
      : rows.length === 0
        ? `<div class="muted">No tools registered yet.</div>`
        : journal + rows
            .map(
              (row, i) => `
      <div class="tool">
        <div class="name">${esc(row.tool.name)}</div>
        ${row.tool.title && row.tool.title !== row.tool.name ? `<div class="muted">title: ${esc(row.tool.title)}</div>` : ''}
        <div class="desc">${esc(row.tool.description ?? '')}</div>
        <div class="muted">annotations the browser kept: ${
          row.tool.annotations && Object.keys(row.tool.annotations).length
            ? esc(JSON.stringify(row.tool.annotations))
            : 'none'
        }</div>
        ${row.findings.map(findingHtml).join('')}
        ${row.findings.length === 0 ? '<div class="ok">✓ looks usable by an agent</div>' : ''}
        <input data-input="${i}" placeholder='{"arg":"value"}' value='${esc(row.lastInput ?? exampleInput(row.tool.inputSchema))}'>
        <button data-run="${i}">Run</button>
        ${row.lastError ? `<div class="f error">${esc(row.lastError)}</div>` : ''}
        ${
          row.lastResult !== undefined
            ? `<div class="muted">the agent receives:</div><pre>${esc(row.lastResult)}</pre>
               ${(row.resultFindings ?? []).map(findingHtml).join('')}
               ${(row.resultFindings ?? []).length === 0 ? '<div class="ok">✓ clean result</div>' : ''}`
            : ''
        }
      </div>`,
            )
            .join('')

    const errors = rows.flatMap((r) => [...r.findings, ...(r.resultFindings ?? [])])
      .filter((f) => f.severity === 'error').length

    host.innerHTML = `
      <header data-toggle>
        <b>webmcpable</b>
        <span class="muted">${rows.length} tool${rows.length === 1 ? '' : 's'}${errors ? ` · ${errors} error${errors === 1 ? '' : 's'}` : ''}</span>
        <span class="grow"></span>
        <button data-copy>Copy report</button>
        <button data-refresh>↻</button>
        <span>${open ? '▾' : '▸'}</span>
      </header>
      ${open ? `<div class="body">${body}</div>` : ''}`
    host.prepend(style)
  }

  host.addEventListener('click', (event) => {
    const el = event.target as HTMLElement
    if (el.closest('[data-toggle]') && !el.matches('button')) {
      open = !open
      return render()
    }
    if (el.matches('[data-refresh]')) {return void refresh()}
    if (el.matches('[data-copy]')) {
      void navigator.clipboard.writeText(report())
      el.textContent = 'Copied'
      setTimeout(() => (el.textContent = 'Copy report'), 1200)
      return
    }
    const runIndex = el.getAttribute('data-run')
    if (runIndex !== null) {
      const row = rows[Number(runIndex)]
      const input = host.querySelector<HTMLInputElement>(`[data-input="${runIndex}"]`)
      if (row) {void run(row, input?.value ?? '{}')}
    }
  })

  ;(options.container ?? document.body).append(host)
  document.modelContext?.addEventListener('toolchange', () => void refresh())
  void refresh()

  return {
    destroy() {
      host.remove()
    },
  }
}
