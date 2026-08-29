import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

const alias = { '~': fileURLToPath(new URL('./src', import.meta.url)) }

/**
 * Two projects, split by file extension.
 *
 * The engine, parsers, tax and table logic are pure functions over plain data
 * and run far faster without a DOM; components and hooks need one. `.test.ts`
 * therefore means node and `.test.tsx` means jsdom — the same split the lint
 * config already draws.
 */
export default defineConfig({
  resolve: { alias },
  test: {
    projects: [
      {
        resolve: { alias },
        test: {
          name: 'lib',
          globals: true,
          environment: 'node',
          include: ['src/**/*.test.ts'],
        },
      },
      {
        resolve: { alias },
        test: {
          name: 'dom',
          globals: true,
          environment: 'jsdom',
          include: ['src/**/*.test.tsx'],
          setupFiles: ['src/test/setupDom.ts'],
        },
      },
    ],
  },
})
