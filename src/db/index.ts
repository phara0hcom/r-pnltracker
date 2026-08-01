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

const pool =
  globalThis.__pnlPool ??
  new Pool({
    connectionString,
    // Neon terminates idle connections; keep the pool small and let it recycle.
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    // Neon presents a valid public certificate, so verify it. `pg` warns that
    // bare `sslmode=require` will stop implying verification in a future major,
    // so the trust decision is made here explicitly rather than via the URL.
    ssl: connectionString.includes('localhost') ? false : { rejectUnauthorized: true },
  })

if (process.env.NODE_ENV !== 'production') globalThis.__pnlPool = pool

export const db = drizzle(pool, { schema })
export { schema }
export type Db = typeof db
