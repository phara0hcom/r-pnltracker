/**
 * The pool's error listener, which is the only thing standing between an idle
 * connection dying and the whole instance dying with it.
 *
 * `pg` routes a fault on an idle client to `pool.emit('error', …)`, and `Pool`
 * is an `EventEmitter`: with no listener Node *throws* rather than delivering.
 * In production that throw is raised from a socket callback, so it reaches
 * `uncaughtException` and kills the serverless function — which is how an
 * already-answered request came to be recorded against a fatal crash.
 *
 * The assertion that matters is the wiring, not the handler: a handler that
 * exists but is attached to nothing fixes nothing. So this drives the real
 * pool the module builds, reached through the `globalThis` cache it keeps.
 *
 * No database is involved. `new Pool()` is lazy — it connects on the first
 * query — so the module can be imported, and its pool made to emit, against a
 * connection string nothing ever dials.
 */
import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { reportError } = vi.hoisted(() => ({ reportError: vi.fn() }))

vi.mock('~/lib/observability/report', () => ({
  reportError,
  reportWarning: vi.fn(),
  breadcrumb: vi.fn(),
  reportMeasurement: vi.fn(),
}))

/** Local, and never dialled: `isLocalHost` matches it, so no TLS is set up either. */
const UNUSED_CONNECTION = 'postgres://user:pass@127.0.0.1:5432/pnl'

const originalUrl = process.env.DATABASE_URL

beforeEach(() => {
  vi.resetModules()
  reportError.mockClear()
  delete globalThis.__pnlPool
  process.env.DATABASE_URL = UNUSED_CONNECTION
})

afterEach(async () => {
  await globalThis.__pnlPool?.end()
  delete globalThis.__pnlPool
  if (originalUrl === undefined) delete process.env.DATABASE_URL
  else process.env.DATABASE_URL = originalUrl
})

describe('the connection pool', () => {
  it('reports a dead idle connection instead of crashing the process', async () => {
    await import('./index')
    const pool = globalThis.__pnlPool
    expect(pool).toBeDefined()

    // The exact error `pg` raises when the socket closes under an idle client;
    // Neon closing a connection a frozen instance still believes it holds is
    // the ordinary way this happens, not a rare one.
    const dead = new Error('Connection terminated unexpectedly')

    expect(() => pool?.emit('error', dead)).not.toThrow()
    expect(reportError).toHaveBeenCalledWith(dead, { source: 'db-pool' })
  })

  it('attaches exactly one listener, so a cached pool is not re-registered', async () => {
    await import('./index')
    const pool = globalThis.__pnlPool
    expect(pool?.listenerCount('error')).toBe(1)

    // What HMR does: the module runs again and finds the pool on `globalThis`.
    // A listener added beside that lookup would stack up and report each fault
    // once per reload.
    vi.resetModules()
    await import('./index')

    expect(globalThis.__pnlPool).toBe(pool)
    expect(pool?.listenerCount('error')).toBe(1)
  })

  it('pins the Node behaviour the listener exists to prevent', () => {
    // Not a test of our code — a guard on the assumption underneath it. If an
    // unheard 'error' ever stops throwing, the comment in `index.ts` is wrong.
    const unheard = new EventEmitter()
    expect(() => unheard.emit('error', new Error('boom'))).toThrow('boom')
  })
})
