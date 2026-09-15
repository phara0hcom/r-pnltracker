/**
 * Database connection.
 *
 * Uses `pg` over Neon's pooled endpoint, which works identically against a
 * local Postgres — the only difference between dev and production is the
 * connection string.
 *
 * The pool is cached on `globalThis` so Vite's HMR does not open a new one on
 * every reload, and so serverless invocations reuse a warm connection instead
 * of exhausting Postgres' connection limit.
 */
import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import * as schema from './schema'
import { reportError, reportWarning } from '~/lib/observability/report'

const connectionString = process.env.DATABASE_URL

if (!connectionString) {
  throw new Error(
    'DATABASE_URL is not set. Copy .env.example to .env and fill it in — see SETUP.md §1.',
  )
}

declare global {
  // Cached across HMR reloads and serverless invocations.
  var __pnlPool: Pool | undefined
}

/**
 * True only for a database on this machine.
 *
 * Matched on the parsed hostname, never on the raw string: a substring test
 * would also match a *password* or database name containing "localhost" and
 * silently drop TLS against a production host. An unparseable URL is treated as
 * remote, so the failure mode is a stricter connection rather than a plaintext
 * one.
 */
function isLocalHost(url: string): boolean {
  try {
    const { hostname } = new URL(url)
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1'
  } catch {
    /*
     * Reported because this catch decides whether TLS is verified.
     *
     * It fails closed — an unparseable URL is treated as remote, so the result is
     * a stricter connection rather than a plaintext one — which is exactly why it
     * could be wrong for a long time without anyone noticing.
     *
     * A no-op if Sentry has not initialised yet: this runs while the pool is
     * being built, and `report.ts` checks for a client before doing anything.
     */
    reportWarning('DATABASE_URL is not a parseable URL — assuming remote', {}, ['bad-database-url'])
    return false
  }
}

/**
 * A pool that cannot crash the process.
 *
 * Built through a function so the `'error'` listener is attached where the pool
 * is *born*, exactly once. Registering it beside the `??` below would re-add it
 * on every HMR reload — the pool there is cached and survives them — and report
 * one fault once per reload.
 */
function createPool(connection: string): Pool {
  const created = new Pool({
    connectionString: connection,
    // Neon terminates idle connections; keep the pool small and let it recycle.
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    // Neon presents a valid public certificate, so verify it. `pg` warns that
    // bare `sslmode=require` will stop implying verification in a future major,
    // so the trust decision is made here explicitly rather than via the URL.
    ssl: isLocalHost(connection) ? false : { rejectUnauthorized: true },
  })

  /*
   * `pg` emits `'error'` on the *pool* when a fault reaches a client sitting
   * idle in it, and `Pool` is an `EventEmitter` — so with no listener Node
   * throws the error instead of delivering it. That throw happens in a socket
   * callback rather than inside a request, so it reaches `uncaughtException`
   * and takes the whole instance down. The Sentry event for it carried
   * `status_code: 200`: the request it killed had already been answered.
   *
   * It is not an edge case here. Neon closes idle connections, and on Vercel
   * the instance is frozen between invocations — `idleTimeoutMillis` above
   * cannot be relied on to reap the client first, because its timer does not
   * run while the instance is frozen. The close then arrives when the instance
   * next thaws.
   *
   * `pg-pool` removes the client from the pool *before* it emits, so the pool
   * heals itself and the crash was the only damage. Reporting it and returning
   * is the whole fix.
   */
  created.on('error', (error) => {
    reportError(error, { source: 'db-pool' })
  })

  return created
}

const pool = globalThis.__pnlPool ?? createPool(connectionString)

// Cached in every environment. Production is the case the cache is actually for
// — a serverless instance that reuses a warm connection instead of opening one
// per invocation — so guarding this on NODE_ENV would exclude the only place it
// matters and leave it doing nothing but deduplicating HMR reloads.
globalThis.__pnlPool = pool

export const db = drizzle(pool, { schema })
export { schema }
export type Db = typeof db
