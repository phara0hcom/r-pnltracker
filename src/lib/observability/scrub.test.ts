import type { ErrorEvent } from '@sentry/tanstackstart-react'
import { describe, expect, it } from 'vitest'
import {
  redactTvSecret,
  scrubBreadcrumb,
  scrubEvent,
  scrubMetric,
  scrubTransaction,
  stripQuery,
} from './scrub'

/**
 * An event shaped like the ones this app actually produces: a screen request
 * carrying filter state in the query string, a session cookie, the allowlisted
 * address, and a POST body with an amount in it.
 */
function realisticEvent(): ErrorEvent {
  return {
    type: undefined,
    message: 'slow server fn',
    transaction: 'POST /api/tv/8f3a9c2b1d4e5f60718293a4b5c6d7e8',
    request: {
      method: 'POST',
      url: 'https://pnl.example.com/positions?symbol=8411&from=2026-01-01&account=NISA',
      query_string: 'symbol=8411&from=2026-01-01&account=NISA',
      env: { DATABASE_URL: 'postgresql://user:pass@host/db' },
      data: { symbol: '8411', price: '1234.5', quantity: '300' },
      cookies: { 'better-auth.session_token': 'abc123' },
      headers: {
        cookie: 'better-auth.session_token=abc123',
        referer: 'https://pnl.example.com/api/tv/8f3a9c2b1d4e5f60718293a4b5c6d7e8',
      },
    },
    user: { id: 'usr_1', email: 't.elsay3d@gmail.com', username: 'tamer' },
    extra: { balance: '4831200', holdings: ['8411', 'AAPL'] },
    contexts: {
      state: { state: { type: 'redux', value: { positions: [{ symbol: '8411' }] } } },
      trace: { trace_id: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', span_id: 'abc', op: 'function.server' },
    },
    tags: { fn: 'getPositions', accountType: 'NISA', durationMs: 2400 },
    sdkProcessingMetadata: {
      normalizedRequest: {
        url: 'https://pnl.example.com/positions?symbol=8411',
        headers: { cookie: 'better-auth.session_token=abc123' },
      },
      dynamicSamplingContext: { trace_id: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' },
    },
  }
}

describe('scrubEvent', () => {
  it('removes the request body, cookies and headers', () => {
    const event = scrubEvent(realisticEvent())

    expect(event.request?.data).toBeUndefined()
    expect(event.request?.cookies).toBeUndefined()
    expect(event.request?.headers).toBeUndefined()
    // The method is diagnostic and carries nothing about the holding.
    expect(event.request?.method).toBe('POST')
  })

  it('removes the user entirely rather than hashing it', () => {
    // One user, so an identifier distinguishes nothing and only adds PII.
    expect(scrubEvent(realisticEvent()).user).toBeUndefined()
  })

  it('drops extra and contexts.state, the unaudited payload channels', () => {
    const event = scrubEvent(realisticEvent())

    expect(event.extra).toBeUndefined()
    expect(event.contexts?.state).toBeUndefined()
    // `contexts.trace` is how Sentry stitches a span to its transaction — it has
    // to survive, or the timing events arrive unlinked.
    expect(event.contexts?.trace).toEqual({
      trace_id: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      span_id: 'abc',
      op: 'function.server',
    })
  })

  it('strips the query string, which describes what the user holds', () => {
    const event = scrubEvent(realisticEvent())

    expect(event.request?.url).toBe('https://pnl.example.com/positions')
  })

  it('also removes query_string, which is a separate field from url', () => {
    // Stripping the query from `url` alone left the filter state fully intact
    // here. The SDK's HTTP instrumentation populates it, not us, so nothing in
    // the app's own code ever revealed the gap.
    expect(scrubEvent(realisticEvent()).request?.query_string).toBeUndefined()
  })

  it('removes request.env, which carries DATABASE_URL on the server', () => {
    expect(scrubEvent(realisticEvent()).request?.env).toBeUndefined()
  })

  it('removes the second copy of the request hidden in sdkProcessingMetadata', () => {
    // `sdkProcessingMetadata` is not internal-only: it reaches the wire verbatim,
    // and `normalizedRequest` is an unstripped url + headers.
    const event = scrubEvent(realisticEvent())

    expect(event.sdkProcessingMetadata?.normalizedRequest).toBeUndefined()
    // The sampling context must survive, or trace propagation breaks.
    expect(event.sdkProcessingMetadata?.dynamicSamplingContext).toEqual({
      trace_id: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    })
  })

  it('keeps the domain shape a failure has to be debugged from', () => {
    const event = scrubEvent(realisticEvent())

    expect(event.message).toBe('slow server fn')
    expect(event.tags).toEqual({ fn: 'getPositions', accountType: 'NISA', durationMs: 2400 })
  })

  it('leaves an event with no request or contexts alone', () => {
    const bare: ErrorEvent = { type: undefined, message: 'boom' }

    expect(scrubEvent(bare)).toEqual({ type: undefined, message: 'boom' })
  })

  it('does not mutate the event it was given', () => {
    const original = realisticEvent()
    scrubEvent(original)

    expect(original.user).toBeDefined()
    expect(original.request?.data).toBeDefined()
  })
})

describe('redactTvSecret', () => {
  it('hides the webhook secret wherever it appears in a path', () => {
    expect(redactTvSecret('POST /api/tv/8f3a9c2b1d4e5f60')).toBe('POST /api/tv/[redacted]')
    expect(redactTvSecret('https://pnl.example.com/api/tv/deadbeef?x=1')).toBe(
      'https://pnl.example.com/api/tv/[redacted]?x=1',
    )
  })

  it('does not need the secret in order to hide it', () => {
    // The scrubber runs in the browser too, where TRADINGVIEW_WEBHOOK_SECRET is
    // not available — matching on the path segment is what keeps it from failing
    // open there.
    expect(redactTvSecret('/api/tv/any-value-at-all')).toBe('/api/tv/[redacted]')
  })

  it('leaves other paths untouched', () => {
    expect(redactTvSecret('/api/auth/callback/google')).toBe('/api/auth/callback/google')
  })
})

describe('scrubTransaction', () => {
  it('redacts the secret from the transaction name', () => {
    // Sentry names HTTP transactions from the URL, so without this the secret
    // would be the issue title.
    expect(scrubTransaction(realisticEvent()).transaction).toBe('POST /api/tv/[redacted]')
  })

  it('redacts the secret from a referer-bearing url', () => {
    const event = scrubTransaction({
      type: undefined,
      request: { url: 'https://pnl.example.com/api/tv/8f3a9c2b1d4e5f60' },
    })

    expect(event.request?.url).toBe('https://pnl.example.com/api/tv/[redacted]')
  })
})

describe('scrubBreadcrumb', () => {
  it('strips query and secret from a fetch breadcrumb', () => {
    const crumb = scrubBreadcrumb({
      category: 'fetch',
      data: { url: 'https://pnl.example.com/api/tv/deadbeef?symbol=8411', status_code: 200 },
    })

    expect(crumb.data?.url).toBe('https://pnl.example.com/api/tv/[redacted]')
    expect(crumb.data?.status_code).toBe(200)
  })

  it('redacts a console breadcrumb that echoed the secret', () => {
    const crumb = scrubBreadcrumb({
      category: 'console',
      message: '[tv] POST /api/tv/deadbeef 404',
    })

    expect(crumb.message).toBe('[tv] POST /api/tv/[redacted] 404')
  })

  it('leaves a breadcrumb with no url or message alone', () => {
    expect(scrubBreadcrumb({ category: 'ui.click' })).toEqual({
      category: 'ui.click',
    })
  })
})

describe('stripQuery', () => {
  it('cuts the query string from a beacon url', () => {
    expect(stripQuery({ url: 'https://x/positions?symbol=8411' })).toEqual({ url: 'https://x/positions' })
  })

  it('returns the event unchanged when there is no query', () => {
    const event = { url: 'https://x/positions', type: 'vital' as const }

    expect(stripQuery(event)).toBe(event)
  })
})

describe('scrubMetric', () => {
  it('redacts a secret from the metric name and its attributes', () => {
    const metric = scrubMetric({
      name: 'webhook./api/tv/8f3a9c2b1d4e5f60',
      value: 1234,
      type: 'distribution',
      unit: 'millisecond',
      attributes: { serverFn: 'getDashboard', path: '/api/tv/8f3a9c2b1d4e5f60' },
    })

    expect(metric.name).toBe('webhook./api/tv/[redacted]')
    expect(metric.attributes?.path).toBe('/api/tv/[redacted]')
  })

  it('over-redacts a dotted suffix rather than risk under-redacting', () => {
    /*
     * `[^/?#\s]+` does not stop at a dot, because a dot is an ordinary character
     * in a URL path segment and stopping there would leave the tail of a secret
     * exposed. In a *metric name* that means a suffix after the secret is eaten
     * too. That is the right direction to be wrong in, and it is asserted so the
     * behaviour is a decision rather than a surprise.
     */
    expect(redactTvSecret('webhook./api/tv/abc123.duration')).toBe('webhook./api/tv/[redacted]')
  })

  it('leaves the reading itself alone', () => {
    // The value and unit are the entire point of a measurement.
    const metric = scrubMetric({
      name: 'web_vital.lcp',
      value: 4200,
      type: 'distribution',
      unit: 'millisecond',
      attributes: { vital: 'LCP', rating: 'poor', navigationType: 'navigate' },
    })

    expect(metric.value).toBe(4200)
    expect(metric.unit).toBe('millisecond')
    expect(metric.attributes).toEqual({
      vital: 'LCP',
      rating: 'poor',
      navigationType: 'navigate',
    })
  })

  it('passes through non-string attribute values untouched', () => {
    const metric = scrubMetric({
      name: 'server_fn.duration',
      value: 12,
      type: 'distribution',
      attributes: { durationMs: 12, cached: false },
    })

    expect(metric.attributes).toEqual({ durationMs: 12, cached: false })
  })
})
