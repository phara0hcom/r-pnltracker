/**
 * What the service worker does with each request, as plain functions.
 *
 * `src/sw/sw.ts` is event glue. Every decision that could leak data or show a
 * wrong figure is made here instead, where a test can reach it:
 *
 * - **Only GET is ever saved.** Every write in the app is a POST server function,
 *   and answering one from a cache would claim a save that never happened.
 * - **`/api/*` is never touched.** Better Auth's endpoints and the TradingView
 *   webhook answer a session or a machine, not a screen, and the OAuth callback
 *   must reach the server exactly as the browser sent it.
 * - **Pages and GET server functions go to the network first.** The saved copy
 *   is used only when the network *fails* — never because the server was slow
 *   or answered with an error, which would put old figures on screen while the
 *   app was up.
 * - **Build assets are content-hashed**, so a cached one cannot be stale.
 */

export type Strategy =
  /** Not intercepted at all: the browser handles it exactly as without a worker. */
  | 'passthrough'
  /** A hashed build file, served from the precache. */
  | 'asset'
  /** A document navigation: network first, then the saved copy, then the offline page. */
  | 'page'
  /** A GET server function: network first, then the saved copy. */
  | 'data'

/** Every cache this app creates starts with this, so activation never deletes anyone else's. */
const CACHE_PREFIX = 'pnl-'
const SAVED_PREFIX = `${CACHE_PREFIX}saved-`

/**
 * Cache names for one build.
 *
 * The build is in both names, so activating a new worker discards the previous
 * build's saved copies as well as its assets. A saved server-function response
 * is shaped for the code that requested it, and the next deploy's code may read
 * a different shape.
 */
export function cacheNames(build: string): { assets: string; saved: string } {
  return { assets: `${CACHE_PREFIX}assets-${build}`, saved: `${SAVED_PREFIX}${build}` }
}

export const isOwnCache = (name: string): boolean => name.startsWith(CACHE_PREFIX)

/** A cache of saved figures, from any build — what sign-out has to remove. */
export const isSavedCopyCache = (name: string): boolean => name.startsWith(SAVED_PREFIX)

/**
 * Pages that are never saved, although they are fetched like any other.
 *
 * A saved sign-in page would offer a Google button that cannot work offline; the
 * offline page says what is actually wrong.
 */
const NEVER_SAVED = new Set(['/signin'])

export function strategyFor(
  request: Pick<Request, 'method' | 'url' | 'mode'>,
  origin: string,
): Strategy {
  if (request.method !== 'GET') return 'passthrough'

  const url = new URL(request.url)
  if (url.origin !== origin) return 'passthrough'
  if (url.pathname.startsWith('/api/')) return 'passthrough'
  if (url.pathname.startsWith('/assets/')) return 'asset'
  if (url.pathname.startsWith('/_serverFn/')) return 'data'
  if (request.mode === 'navigate') return 'page'
  return 'passthrough'
}

/**
 * Whether a network response may become the saved copy for its request.
 *
 * A redirect is refused in both of its forms. A navigation that the guard sent
 * to sign-in arrives as `opaqueredirect`; a followed one arrives `redirected`.
 * Either way the body is not the screen that was asked for, and saving it would
 * file the sign-in page under `/positions`.
 */
export function shouldSave(
  request: Pick<Request, 'url'>,
  response: Pick<Response, 'status' | 'type' | 'redirected'>,
): boolean {
  if (response.status !== 200) return false
  if (response.type !== 'basic') return false
  if (response.redirected) return false
  return !NEVER_SAVED.has(new URL(request.url).pathname)
}

export const SAVED_AT_HEADER = 'x-pnl-saved-at'

/** Saved figures older than this are discarded rather than shown. */
export const MAX_SAVED_AGE_MS = 30 * 24 * 60 * 60 * 1000

/**
 * A copy of `response` carrying the time it was saved.
 *
 * Built anew because a fetched response's headers are immutable. The encoding
 * and length headers are dropped: the body read here is already decoded, and
 * serving it back under the original `content-encoding` would describe bytes
 * that no longer exist.
 */
export async function stamp(response: Response, now: number): Promise<Response> {
  const headers = new Headers(response.headers)
  headers.set(SAVED_AT_HEADER, String(now))
  headers.delete('content-encoding')
  headers.delete('content-length')
  return new Response(await response.blob(), {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}

/** When a saved copy was saved, or null if it carries no usable stamp. */
export function savedAtOf(response: Pick<Response, 'headers'>): number | null {
  const raw = response.headers.get(SAVED_AT_HEADER)
  if (raw === null) return null
  const savedAt = Number(raw)
  return Number.isFinite(savedAt) ? savedAt : null
}

export const isExpired = (savedAt: number, now: number): boolean => now - savedAt > MAX_SAVED_AGE_MS
