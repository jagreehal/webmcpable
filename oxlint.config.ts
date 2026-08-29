import nkzw from '@nkzw/oxlint-config';
import { defineConfig } from 'oxlint';

export default defineConfig({
  extends: [nkzw],
  ignorePatterns: ['**/dist/**', 'spike/**'],
  overrides: [
    {
      files: ['**/*.test.ts', '**/*.test.tsx', '**/demo/**', '**/e2e/**'],
      rules: {
        // Test components and helpers belong next to the case they serve, and
        // a conformance test about ordering has to be free to write keys out
        // of order — sorting them would delete the thing under test.
        'perfectionist/sort-objects': 'off',
        'react-hooks/rules-of-hooks': 'off',
        'react/globals': 'off',
        'unicorn/consistent-function-scoping': 'off',
      },
    },
    {
      env: { node: true },
      files: ['**/e2e/fixtures/*.mjs', '*.config.ts'],
      rules: {},
    },
  ],
  rules: {
    // `import * as z from 'zod'` is the documented Zod v4 import.
    'import/no-namespace': 'off',
    // A library that swallows a registration failure is worse than a noisy one.
    // `log`/`debug` stay banned; these two are how a library reports.
    'no-console': ['error', { allow: ['error', 'warn'] }],
  },
});
