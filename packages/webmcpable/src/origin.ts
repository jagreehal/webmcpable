/**
 * Is this origin one the platform will accept in `exposedTo`?
 *
 * "Potentially trustworthy" is the HTML spec's term, and the fake in
 * `webmcpable/testing` refuses anything else the way the browser does. The CLI
 * reads the same rule so a bad origin fails the build instead of the page.
 */
const IPV4_LOOPBACK = /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/

export function isPotentiallyTrustworthyOrigin(origin: string): boolean {
  let url: URL
  try {
    url = new URL(origin)
  } catch {
    return false
  }
  if (url.protocol === 'file:') {return true}
  if (url.origin !== origin) {return false}
  if (url.protocol === 'https:' || url.protocol === 'wss:') {return true}
  return (
    url.hostname === 'localhost' ||
    url.hostname.endsWith('.localhost') ||
    // Secure Contexts is the whole 127.0.0.0/8 block, not just 127.0.0.1, and
    // `URL` hands IPv6 back bracketed. `new URL` has already rejected an octet
    // out of range, so matching the shape is enough.
    IPV4_LOOPBACK.test(url.hostname) ||
    url.hostname === '[::1]'
  )
}
