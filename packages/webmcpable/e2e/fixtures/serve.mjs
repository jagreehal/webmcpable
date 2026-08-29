// A five-line static server beats a dependency. Rooted at the package so the
// harness can import the real built bundle from /dist, exactly as a consumer does.
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { extname, join, normalize } from 'node:path'

const ROOT = new URL('../..', import.meta.url).pathname
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.map': 'application/json' }

createServer(async (req, res) => {
  const path = join(ROOT, normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)))
  try {
    const body = await readFile(path)
    res.writeHead(200, { 'content-type': TYPES[extname(path)] ?? 'application/octet-stream' })
    res.end(body)
  } catch {
    res.writeHead(404).end('not found')
  }
}).listen(Number(process.env.PORT ?? 5178))
