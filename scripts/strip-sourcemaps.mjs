/**
 * Removes source maps from the published output, always.
 *
 * `sentryTanstackStart` is configured with `filesToDeleteAfterUpload`, but that
 * deletion is part of the *upload* step: when the upload fails the maps are left
 * behind, and the build still succeeds. A deploy with an expired
 * `SENTRY_AUTH_TOKEN` therefore published 63 `.js.map` files carrying full
 * `sourcesContent` — the whole of `lib/auth.ts` and the exit-rule engine, served
 * at a predictable URL beside each chunk. `sourcemap: 'hidden'` only omits the
 * `//# sourceMappingURL` comment; it does not stop anyone fetching them.
 *
 * A build step rather than a Vite plugin on purpose. A plugin would have to run
 * after Sentry's upload hook and would silently break uploads if that ordering
 * ever changed; this runs strictly after `vite build` has finished, so it cannot
 * race with the upload and cannot delete a map before it is sent.
 */
import { readdir, rm } from 'node:fs/promises'
import { join } from 'node:path'

/** Local build, and the Vercel preset's published directory. */
const PUBLIC_DIRS = ['.output/public', '.vercel/output/static']

async function removeMaps(dir) {
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true, recursive: true })
  } catch {
    return 0 // Directory not produced by this build.
  }

  const maps = entries.filter((entry) => entry.isFile() && entry.name.endsWith('.map'))
  await Promise.all(maps.map((entry) => rm(join(entry.parentPath, entry.name), { force: true })))
  return maps.length
}

const removed = (await Promise.all(PUBLIC_DIRS.map(removeMaps))).reduce((a, b) => a + b, 0)
console.log(`[build] removed ${removed} source map(s) from the published output`)
