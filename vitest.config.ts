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
 *
 * `.db.test.ts` is a third kind, and is deliberately not in `npm test`. Those
 * start a real Postgres in a container: seconds rather than milliseconds, and
 * only where a container runtime exists. The verification loop is run after
 * every change and has to stay fast enough that nobody is tempted to skip it,
 * so they live behind `npm run test:db` and are asked for on purpose.
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
          exclude: ['**/node_modules/**', 'src/**/*.db.test.ts'],
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
      {
        resolve: { alias },
        test: {
          name: 'db',
          globals: true,
          environment: 'node',
          include: ['src/**/*.db.test.ts'],
          /* Pulling the image on a cold machine dominates the first run. */
          testTimeout: 60_000,
          hookTimeout: 300_000,
        },
      },
    ],
  },
})
