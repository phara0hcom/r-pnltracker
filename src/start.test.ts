import { describe, expect, it } from 'vitest'
import { csrf, startInstance } from './start'

interface CsrfContext {
  handlerType: 'request' | 'serverFn'
  request: Request
  next: () => Promise<object>
}

/** `createCsrfMiddleware` returns its check as an opaque `options.server`. */
function invokeCsrf(ctx: CsrfContext): Promise<unknown> {
  const server = csrf.options.server as unknown as (c: CsrfContext) => Promise<unknown>
  return server(ctx)
}

/**
 * Guards a regression the framework will not warn about in production.
 *
 * `createStartHandler` applies its own CSRF middleware *only* while no start
 * instance exists:
 *
 *     requestMiddleware: hasStartInstance ? startOptions.requestMiddleware : [defaultCsrfMiddleware]
 *
 * So the act of adding `src/start.ts` — which this feature did, to get global
 * tracing — moved CSRF protection for all 28 server functions from a framework
 * default into our hands. Dropping `csrf` from that array would disable it
 * silently, and the framework's only complaint is a `console.warn` gated on
 * `NODE_ENV !== 'production'`.
 */
describe('start instance', () => {
  it('still registers CSRF protection for server functions', async () => {
    const options = await startInstance.getOptions()

    expect(options.requestMiddleware).toContain(csrf)
  })

  it('runs CSRF before anything observes the request', async () => {
    const options = await startInstance.getOptions()

    // A request that fails the check should be refused, not traced.
    expect(options.requestMiddleware?.indexOf(csrf)).toBe(0)
  })

  it('scopes CSRF to server functions, leaving the webhook route reachable', async () => {
    /*
     * The `filter` is what keeps `/api/tv/$secret` working.
     * `allowRequestsWithoutOriginCheck` defaults to false, and TradingView sends
     * no Origin, no Sec-Fetch-Site and no Referer — so an unfiltered CSRF
     * middleware would answer every delivery with a 403.
     *
     * Asserted by running the middleware rather than by reading its options: the
     * filter is closed over inside `options.server`, and behaviour is the thing
     * worth pinning anyway.
     */
    const run = async (handlerType: 'request' | 'serverFn') => {
      let reached = false
      await invokeCsrf({
        handlerType,
        request: new Request('https://pnl.example.com/api/tv/secret', { method: 'POST' }),
        next: () => {
          reached = true
          return Promise.resolve({})
        },
      })
      return reached
    }

    // A TradingView delivery: POST with none of the three CSRF signals present.
    await expect(run('request')).resolves.toBe(true)
    // The same bare request aimed at a server function is refused.
    await expect(run('serverFn')).resolves.toBe(false)
  })

  it('traces and times every server function', async () => {
    const options = await startInstance.getOptions()

    expect(options.functionMiddleware).toHaveLength(2)
  })
})
