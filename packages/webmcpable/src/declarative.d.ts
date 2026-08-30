/**
 * Types for WebMCP's declarative tools — the `<form toolname>` the browser
 * registers on your behalf. No runtime: reference this file, do not import it.
 *
 *   /// <reference types="webmcpable/declarative" />
 *
 * The browser owns declarative registration; this only stops TypeScript
 * rejecting the attributes in JSX.
 */

declare module 'react' {
  interface HTMLAttributes<T> {
    /** Present: submit as soon as the agent has filled every parameter. */
    toolautosubmit?: boolean | string | undefined
    /** What the tool does, in the words the agent reads. */
    tooldescription?: string | undefined
    /** Registers this form as a tool under this name. */
    toolname?: string | undefined
    /** What this field means. Goes on the input, select or textarea. */
    toolparamdescription?: string | undefined
  }
}

export {}
