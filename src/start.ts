/**
 * Global middleware for every request and every server function.
 *
 * This file exists so that tracing and timing apply everywhere without being
 * repeated across 28 server functions — including `getSessionUser`, which has no
 * middleware of its own and runs on every authenticated navigation, and the
 * TradingView route, which bypasses `server/middleware.ts` by design.
 *
 * ## It is also the most dangerous file in the repo
 *
 * `createStartHandler` reads:
 *
 *     requestMiddleware: hasStartInstance ? startOptions.requestMiddleware : [defaultCsrfMiddleware]
 *
 * Until this file existed there was no start instance, so *every* server function
 * was CSRF-protected by that default. The moment one exists, `requestMiddleware`
 * is taken verbatim — so omitting `csrf` below silently removes CSRF protection
 * from all 28 of them. The only warning the framework gives is a `console.warn`
 * gated on `NODE_ENV !== 'production'`, which is to say: none where it matters.
 *
 * `sameOrigin` in `server/middleware.ts` is not a substitute. It is a *function*
 * middleware, it skips requests that arrive with no `Origin` header, and its own
 * TODO notes it throws a 500 rather than a rejection on `Origin: null`.
 *
 * `start.test.ts` asserts the middleware is still registered, because this is
 * exactly the kind of quiet regression `noServerCodeInClient()` was written for.
 */
import {
  sentryGlobalFunctionMiddleware,
  sentryGlobalRequestMiddleware,
} from '@sentry/tanstackstart-react'
import {
  createCsrfMiddleware,
  createMiddleware,
  createStart,
} from '@tanstack/react-start'
import { SLOW_SERVER_FN_MS } from '~/lib/observability/scrub'

/**
 * Re-declares the protection the framework applied for us until this file existed.
 *
 * The `filter` is load-bearing, not tidiness. Without it this also guards
 * `/api/tv/$secret`, and `allowRequestsWithoutOriginCheck` defaults to `false` —
 * TradingView sends no `Origin`, no `Sec-Fetch-Site` and no `Referer`, so every
 * delivery would be answered with a 403. Matching the framework's own default
 * keeps the boundary exactly where it was.
 */
export const csrf = createCsrfMiddleware({
  filter: (ctx) => ctx.handlerType === 'serverFn',
})

/**
 * Reports a server function that took too long, every time, not 1 in 20.
 *
 * Tracing is sampled at 5% to fit the free tier's 10,000 spans a month, and a
 * `tracesSampler` cannot help here because it decides at span *start*, before
 * there is a duration to judge. So the guarantee that a slow request is never
 * missed lives here instead, and is billed against the roomier 5,000-error
 * budget: normal traffic stays sampled and cheap, a slow one always reports.
 *
 * `fingerprint` groups by function name rather than by message, so a hundred slow
 * calls to `getDashboard` are one issue with a hundred events instead of a
 * hundred issues. `serverFnMeta` carries the original variable name and source
 * file, which is what makes the issue title readable.
 *
 * Wrapped so that reporting cannot fail the request — the discipline the
 * TradingView route already applies to its own delivery log.
 */
const timing = createMiddleware({ type: 'function' }).server(async ({ next, serverFnMeta }) => {
  const startedAt = performance.now()
  try {
    return await next()
  } finally {
    const durationMs = Math.round(performance.now() - startedAt)
    if (durationMs > SLOW_SERVER_FN_MS) {
      /*
       * Wrapped because this is a `finally`.
       *
       * An `await` that rejects inside `finally` does not merely fail to report —
       * it *replaces* the exception already in flight, so a failed dynamic import
       * would surface to the caller instead of the real error. `reportWarning`
       * cannot throw, but `import()` can, and the whole point of this block is
       * that measuring a request must never change its outcome.
       */
      try {
        const { reportWarning } = await import('~/lib/observability/report')
        reportWarning(
          `slow server function: ${serverFnMeta.name}`,
          { serverFn: serverFnMeta.name, filename: serverFnMeta.filename, durationMs },
          ['slow-server-fn', serverFnMeta.name],
        )
      } catch {
        // Nothing to do, and nothing worth losing the caller's error over.
      }
    }
  }
})

export const startInstance = createStart(() => ({
  /*
   * `csrf` first: a request that fails it should be refused before anything is
   * traced or measured.
   */
  requestMiddleware: [csrf, sentryGlobalRequestMiddleware],
  /*
   * Global function middleware is *prepended* to each function's own chain, so
   * the order is: sentry → timing → sameOrigin → authed → handler. That is what
   * we want — the span covers the auth check and the ~75ms Neon session query,
   * which is otherwise the least visible cost in a request.
   */
  functionMiddleware: [sentryGlobalFunctionMiddleware, timing],
}))
