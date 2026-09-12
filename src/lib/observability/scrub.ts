/**
 * What may leave this machine.
 *
 * Everything reported to Sentry passes through here first. The app holds one
 * person's real trade history, so the default is to strip rather than to send:
 * identity, credentials, request bodies and URL query strings all go, and what
 * survives is the shape of the failure — message, stack, ticker, account type,
 * counts, durations, status.
 *
 * `src/server/middleware.ts` has carried the note that made this file necessary
 * since before there was anywhere to send logs: *"Also logs the address on every
 * rejection; drop it, or hash it, if these logs ever leave the machine."* They
 * now do.
 *
 * Pure on purpose — no SDK import, no I/O — so the privacy guarantee is a unit
 * test rather than a claim. See `scrub.test.ts`.
 */

/*
 * Sentry's own event types, imported as types only.
 *
 * `import type` is erased under `verbatimModuleSyntax`, so this costs no runtime
 * import and the module stays pure — while the signatures line up exactly with
 * `beforeSend`, `beforeSendTransaction` and `beforeBreadcrumb`. Hand-rolled
 * structural shapes drifted from them immediately: `RequestEventData` has no
 * index signature, `cookies` is a record rather than a string, and `TraceContext`
 * requires a `trace_id`.
 *
 * `Event` rather than `ErrorEvent | TransactionEvent`: the package barrel exports
 * `ErrorEvent` but not `TransactionEvent`, and `Event` is the shared supertype
 * both hooks pass anyway.
 */

import type { Breadcrumb, Event, Metric } from '@sentry/tanstackstart-react'

/** A server function slower than this is reported, not merely sampled. */
export const SLOW_SERVER_FN_MS = 2000

/**
 * Drops the query string before any beacon leaves the browser.
 *
 * This app puts filter state in the URL: `?symbol=8411&from=2026-01-01&account=…`.
 * That is a description of what the user holds and when they traded it, and it
 * has no diagnostic value — the path alone answers "which screen was this".
 * The root document already sets `noindex` and `referrer: no-referrer`, so
 * shipping the same information to a telemetry endpoint would undo that.
 *
 * Generic over the event rather than typed to one package: Speed Insights and
 * Web Analytics each declare their own `BeforeSendEvent` (`vital` vs
 * `pageview`/`event`) and they are not assignable to each other. Both carry
 * `url`, which is the only field being touched — and both hooks must be wired,
 * or the half that is left bare leaks the very thing the other one strips.
 */
export function stripQuery<E extends { url: string }>(event: E): E {
  const cut = event.url.indexOf('?')
  return cut === -1 ? event : { ...event, url: event.url.slice(0, cut) }
}

/**
 * Hides the TradingView webhook secret, which lives in the URL *path*.
 *
 * `/api/tv/<secret>` is authenticated by the path itself — see the header of
 * `src/routes/api/tv/$secret.ts`, which accepts that trade-off because the token
 * is long, single-purpose and rotatable. Sentry names HTTP transactions after
 * the URL and attaches `request.url` to every event, so without this the secret
 * would sit in issue *titles*: a third party holding a credential whose only
 * rotation is an environment-variable change and a redeploy. That was not part
 * of the trade-off the route agreed to.
 *
 * Deliberately matches the path segment rather than the configured secret: the
 * scrubber must not need the secret to hide it, or it fails open wherever
 * `TRADINGVIEW_WEBHOOK_SECRET` is unset — which includes the browser.
 */
export function redactTvSecret(value: string): string {
  return value.replace(/\/api\/tv\/[^/?#\s]+/g, '/api/tv/[redacted]')
}

function scrubUrl(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const cut = value.indexOf('?')
  return redactTvSecret(cut === -1 ? value : value.slice(0, cut))
}

/**
 * The single gate for error and message events.
 *
 * Removes, in order: the request body (a manual-trade POST is price × quantity),
 * cookies and headers (the session token, and the allowlisted address), the user
 * object entirely, and the two channels that accumulate payloads nobody audited
 * — `extra` and `contexts.state`.
 *
 * `user` goes rather than being hashed. There is one user; an identifier
 * distinguishes nothing and only adds something worth protecting.
 */
export function scrubEvent<E extends Event>(event: E): E {
  const { extra: _extra, user: _user, ...rest } = event
  const scrubbed = rest as E

  if (scrubbed.request) {
    /*
     * `query_string` and `env` are separate fields, not parts of `url`.
     *
     * Stripping the query from `url` alone left the filter state intact in
     * `query_string` — the exact thing this file exists to remove — and `env`
     * carries the server's environment, `DATABASE_URL` included. Both are
     * populated by the SDK's own HTTP instrumentation rather than by us, which
     * is why neither showed up until a probe set them deliberately.
     */
    const {
      data: _data,
      cookies: _cookies,
      headers: _headers,
      query_string: _queryString,
      env: _env,
      ...request
    } = scrubbed.request
    scrubbed.request = { ...request, url: scrubUrl(scrubbed.request.url) }
  }

  /*
   * `sdkProcessingMetadata` looks internal and is not: it reaches the wire
   * verbatim, and its `normalizedRequest` holds a second, unstripped copy of the
   * request — full URL, query string and headers.
   *
   * Only that key is removed. `dynamicSamplingContext` lives here too and is read
   * when the envelope header is built, so dropping the whole object would break
   * trace propagation to buy nothing.
   */
  if (scrubbed.sdkProcessingMetadata) {
    const { normalizedRequest: _normalizedRequest, ...metadata } = scrubbed.sdkProcessingMetadata
    scrubbed.sdkProcessingMetadata = metadata
  }

  if (typeof scrubbed.transaction === 'string') {
    scrubbed.transaction = redactTvSecret(scrubbed.transaction)
  }

  if (scrubbed.contexts) {
    const { state: _state, ...contexts } = scrubbed.contexts
    scrubbed.contexts = contexts
  }

  /*
   * Removing optional properties from a generic narrows it to `Omit<E, …>`, and
   * Sentry's hooks require the original type back. The cast is safe in the
   * direction that matters — every field here is optional in `Event`, so an
   * event missing them is still an `Event`.
   */
  return scrubbed
}

/**
 * The same gate for transactions.
 *
 * Separate hook, same rules: `beforeSend` is never called for a transaction, so
 * a scrubber wired only there would let every traced request carry the webhook
 * secret in its name.
 */
export function scrubTransaction<E extends Event>(event: E): E {
  return scrubEvent(event)
}

/**
 * The third hook, and the one easiest to forget.
 *
 * Breadcrumbs are attached to whatever event comes *next*, so an unscrubbed
 * breadcrumb leaks through an otherwise clean event. Fetch and navigation
 * breadcrumbs carry `data.url`; console breadcrumbs carry the message text.
 */
export function scrubBreadcrumb(crumb: Breadcrumb): Breadcrumb {
  const scrubbed: Breadcrumb = { ...crumb }

  if (typeof scrubbed.message === 'string') {
    scrubbed.message = redactTvSecret(scrubbed.message)
  }

  if (scrubbed.data) {
    const url = scrubUrl(scrubbed.data.url)
    scrubbed.data = url === undefined ? scrubbed.data : { ...scrubbed.data, url }
  }

  return scrubbed
}

/**
 * The fourth hook.
 *
 * Metric names and attributes are written by this app rather than assembled by
 * the SDK, so there is far less here to go wrong than in an event — but that was
 * equally true of `request.url` before `query_string` turned up beside it. A
 * measurement passes the same gate as everything else, and a name or attribute
 * that ever carries a webhook path is redacted like any other.
 */
export function scrubMetric(metric: Metric): Metric {
  const scrubbed: Metric = { ...metric, name: redactTvSecret(metric.name) }

  if (scrubbed.attributes) {
    scrubbed.attributes = Object.fromEntries(
      Object.entries(scrubbed.attributes).map(([key, value]) => [
        key,
        typeof value === 'string' ? redactTvSecret(value) : value,
      ]),
    )
  }

  return scrubbed
}
