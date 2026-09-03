import { defineConfig } from 'tsdown'

export default defineConfig([
  {
    clean: true,
    dts: true,
    entry: {
      debug: 'src/debug/index.ts',
      effect: 'src/effect/index.ts',
      index: 'src/index.ts',
      local: 'src/local.ts',
      react: 'src/react/index.ts',
      // Must keep the .svelte.js suffix: a consumer's Svelte plugin only compiles
      // runes in files named that way. Shipping it as plain .js leaves $effect
      // undefined at runtime.
      'svelte.svelte': 'src/svelte/index.svelte.ts',
      testing: 'src/testing/index.ts',
      vue: 'src/vue/index.ts',
    },
    format: ['esm'],
    platform: 'browser',
    sourcemap: true,
    target: 'es2022',
    treeshake: true,
    // Framework adapters must not pull their framework into the bundle.
    deps: {
      neverBundle: ['react', 'vue', 'svelte', 'effect'],
      onlyBundle: false,
    },
  },
  {
    // The Playwright helper runs in the test process, not the page, so it needs
    // node: builtins and must keep @playwright/test external — the consumer
    // already has one, and two copies of the runner do not share fixtures.
    clean: false,
    deps: { neverBundle: ['@playwright/test'], onlyBundle: false },
    dts: true,
    entry: { 'testing-playwright': 'src/testing/playwright.ts' },
    format: ['esm'],
    platform: 'node',
    sourcemap: true,
    target: 'node20',
    treeshake: true,
  },
  {
    // The same fake, bundled flat so `page.addInitScript({ path })` can hand it
    // to a browser. No imports and no exports survive here by design: an init
    // script is evaluated as a plain script, and a bare `import` would throw
    // before the fake was ever installed.
    clean: false,
    dts: false,
    entry: { 'testing-browser': 'src/testing/browser.ts' },
    format: ['iife'],
    platform: 'browser',
    sourcemap: false,
    target: 'es2022',
    treeshake: true,
  },
  {
    // The CLI is a `bin`, never an export, so no bundler reaches it and the
    // browser entries above stay free of node: imports.
    clean: false,
    dts: false,
    entry: { cli: 'src/cli/bin.ts' },
    format: ['esm'],
    platform: 'node',
    sourcemap: true,
    target: 'node20',
    treeshake: true,
  },
])
