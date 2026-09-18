/**
 * TradingView webhook — one daily bar per ticker, per session.
 *
 * The secret sits in the URL path because TradingView alerts cannot send custom
 * headers: the Notifications tab offers a webhook URL and the alert message,
 * nothing else. Putting it in the path keeps the Pine script identical across
 * every alert, which matters when the setup is "repeat once per open position".
 *
 * The trade-off is understood: a path secret can appear in proxy and CDN logs in
 * a way a header would not. It is mitigated by the token being long, single-
 * purpose, rotatable by changing one environment variable, and capable of
 * nothing but appending a price bar for an instrument that already exists.
 *
 * This route deliberately does NOT use the `authed` middleware. There is no
 * session here — TradingView is not a browser — and the bars it writes are
 * market data, shared and user-independent exactly like `price_cache`. That is
 * also why the endpoint never needs to know which user is asking.
 */
import { createHash, timingSafeEqual } from 'node:crypto'
import { createFileRoute } from '@tanstack/react-router'
import { waitUntil } from '@vercel/functions'
import { storeFeedBar, type FeedDeliveryOutcome } from '~/db/exit.service'
import { cacheFeedClose } from '~/db/prices.service'
import type { FeedPayload } from '~/lib/exit/webhook'
import {
  MIN_SECRET_LENGTH,
  parseFeedBody,
  tradingDayCandidates,
  webhookSecretUsable,
} from '~/lib/exit/webhook'
import {
  feedDeliveryReport,
  SLOW_ACCEPT_MS,
  TV_WEBHOOK_ROUTE,
} from '~/lib/observability/feedDelivery'
import {
  breadcrumb,
  reportError,
  reportingEnabled,
  reportMeasurement,
  reportWarning,
} from '~/lib/observability/report'

const json = (body: unknown, status: number): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  })

/**
 * Constant-time comparison over digests.
 *
 * Hashing first is what makes it safe for unequal lengths: `timingSafeEqual`
 * throws outright on a length mismatch, and that throw would itself leak the
 * secret's length to anyone probing the endpoint.
 */
function secretMatches(provided: string, expected: string): boolean {
  const a = createHash('sha256').update(provided).digest()
  const b = createHash('sha256').update(expected).digest()
  return timingSafeEqual(a, b)
}

/**
 * Wraps a report so it fires at most once for the life of this instance.
 *
 * Both callers below sit *above* the secret check, so anyone who can guess the
 * URL shape can reach them. Reporting every time would let an anonymous caller
 * spend the month's error budget on one missing environment variable — the
 * concern that already put `Unauthorised` in `ignoreErrors`. One event per cold
 * start says what is wrong and cannot be turned into a flood.
 *
 * A helper rather than two hand-rolled `let` flags, which is what this was:
 * two byte-parallel blocks whose names differed by one word, teaching the next
 * person to copy whichever one their eye landed on. The `reportError` calls
 * further down are deliberately *not* wrapped — they are past the secret check,
 * so only a real delivery reaches them.
 */
function once<A extends unknown[]>(report: (...args: A) => void): (...args: A) => void {
  let spent = false
  return (...args: A) => {
    if (spent) return
    /*
     * Not spent on a report that goes nowhere.
     *
     * `report.ts` returns silently until `Sentry.init` has made a client, and
     * `instrument.server.ts` says in its own header that Nitro reaches it
     * through two lazy dynamic imports — so `init` runs on the first *request*.
     * If the first thing a cold instance handled was a refused secret, the
     * latch was spent on a no-op and every later refusal on that warm instance
     * was suppressed: precisely the rotated-secret case this exists to catch,
     * silenced by the mechanism meant to surface it.
     *
     * Returning early is safe: with no client there is nothing to flood.
     */
    if (!reportingEnabled()) return
    spent = true
    report(...args)
  }
}

/** The feed is switched off: the secret is unset, or too short to be worth having. */
const reportUnconfigured = once(() => {
  reportWarning('exit feed: webhook secret unset or too short', {
    route: TV_WEBHOOK_ROUTE,
    status: 503,
  }, [TV_WEBHOOK_ROUTE, 'not-configured'])
})

/**
 * Something offered a secret this app does not accept.
 *
 * `method` is the diagnosis, and is the first refusal's — a refused POST is
 * something still *delivering* to a URL this app no longer accepts, which is
 * what a rotated secret looks like from here, while a refused GET is a person
 * checking the URL by hand or a scanner walking the path.
 */
const reportSecretRefused = once((method: 'GET' | 'POST') => {
  reportWarning('exit feed: secret refused', {
    route: TV_WEBHOOK_ROUTE,
    status: 404,
    method,
  }, [TV_WEBHOOK_ROUTE, 'secret-refused'])
})

/**
 * Shared by both verbs — resolves the configured secret and checks the path.
 *
 * `method` is carried only so a refusal can say which verb it refused. It is
 * the difference between a diagnosis and a shrug: a rejected POST is something
 * *delivering* to a URL this app no longer accepts, which is what a rotated
 * secret looks like from here, while a rejected GET is a person checking a URL
 * by hand or a scanner walking the path.
 */
function authorise(secret: string, method: 'GET' | 'POST'): Response | null {
  const expected = process.env.TRADINGVIEW_WEBHOOK_SECRET

  // The same predicate the Exit Rules screen reports with, so a too-short secret
  // cannot 503 every payload while the screen shows the feed as configured.
  if (!webhookSecretUsable(expected)) {
    console.error(
      '[tv] TRADINGVIEW_WEBHOOK_SECRET is unset or shorter than ' +
        `${String(MIN_SECRET_LENGTH)} characters — refusing to accept webhooks.`,
    )
    /*
     * The console line above reaches nobody. Sentry's Console integration is
     * removed in `instrument.server.ts` on purpose, and Vercel's hobby plan
     * keeps runtime logs for an hour — so until now the feed being switched off
     * looked exactly like the feed being quiet.
     */
    reportUnconfigured()
    return json({ error: 'webhook not configured' }, 503)
  }

  /*
   * 404 rather than 401: an unauthenticated prober learns nothing about whether
   * this path is a real endpoint. The answer is unchanged — what is reported
   * about it is not.
   *
   * Reported once per cold start, and never with the secret that was offered.
   * That string is attacker-controlled and is a credential when it is *not* an
   * attack: the case this exists to catch is TradingView still delivering to a
   * rotated URL, where the rejected value is the previous real secret. So the
   * report says that a refusal happened and which verb it refused, and nothing
   * about what was sent. `scrub.ts` redacts the path, but only because nothing
   * here puts the secret anywhere it would have to.
   *
   * Until this existed, a rotated secret was indistinguishable from a port scan
   * and showed up only as deliveries having quietly stopped.
   */
  if (!secretMatches(secret, expected)) {
    reportSecretRefused(method)
    return json({ error: 'not found' }, 404)
  }

  return null
}

/** What survives payload parsing, kept alive across the `waitUntil` boundary. */
type FeedIndicators = Omit<FeedPayload, 'ticker' | 'exchange' | 'time'>

interface PendingDelivery {
  ticker: string
  exchange: string | null
  time: number
  indicators: FeedIndicators
  /** `performance.now()` when the accept phase began — the delivery's own clock. */
  acceptedAt: number
}

/**
 * The bar write and price publish, run *after* the response has already gone
 * to TradingView, via `waitUntil`.
 *
 * Nothing here can become an HTTP status any more — the answer is already
 * sent — so every outcome, expected or not, has to reach Sentry itself or it
 * reaches nobody. That is the trade the route now makes on purpose: TradingView
 * gets its 2xx inside the 3s budget regardless of what the database is doing,
 * and an unknown ticker, a stalled pool, or an unexpected throw shows up as a
 * warning or an error here instead of a 404/5xx there.
 *
 * The two statements are still deliberately two rather than five — see
 * `storeFeedBar`'s own header for why a burst of same-close alerts makes that
 * matter — this just moves them off the request's own clock.
 */
async function processDelivery(delivery: PendingDelivery): Promise<void> {
  const { ticker, exchange, time, indicators, acceptedAt } = delivery
  try {
    const storeStartedAt = performance.now()
    const stored = await storeFeedBar({
      ticker,
      // Both candidates, because which one applies depends on the asset
      // class — which this call resolves and picks with.
      tradingDay: tradingDayCandidates(time, exchange),
      barTime: new Date(time),
      exchange,
      ...indicators,
    })
    const storeDurationMs = Math.round(performance.now() - storeStartedAt)

    if (!stored) {
      // Not an error worth retrying: an alert exists for something this
      // account has never traded, so there is nothing to attach a bar to.
      // TradingView already has its 200 — this can only be reported, not
      // returned — so it has to go to Sentry or nowhere.
      console.error(`[tv] no instrument for ticker ${ticker} — bar discarded`)
      const totalDurationMs = Math.round(performance.now() - acceptedAt)
      // Typed as the database's own enum, so if `exit_feed_deliveries.outcome`
      // ever changes, `feedDeliveryReport`'s union has to follow it or this
      // stops compiling — the one place that drift would otherwise go unnoticed
      // now that nothing writes the table itself.
      const outcome: FeedDeliveryOutcome = 'UNKNOWN_TICKER'
      reportMeasurement('tv_webhook.process_duration', totalDurationMs, 'millisecond', {
        outcome,
        storeDurationMs,
      })
      const report = feedDeliveryReport(outcome, totalDurationMs)
      // UNKNOWN_TICKER is always the 'warning' branch — checked rather than
      // asserted because `feedDeliveryReport`'s return type doesn't encode
      // that per outcome, only `feedDeliveryReport` itself does.
      if (report.channel === 'warning') {
        reportWarning(report.message, {
          route: TV_WEBHOOK_ROUTE,
          ticker,
          exchange,
          storeDurationMs,
        }, report.fingerprint)
      }
      return
    }

    const { symbol, tradingDay, instrumentId, assetClass, backfilled } = stored

    /*
     * The close is also the best price anyone has for this instrument at the
     * moment it lands — see `cacheFeedClose`'s own header for the staleness
     * guards. Publishing it is a bonus; recording the bar is the job, so a
     * failure here is reported and swallowed rather than allowed to mark the
     * whole delivery as failed.
     *
     * `asOf` is delivery time, not the payload's `time`, which is the bar's
     * *open*. Filing a close under its opening timestamp would date every JP
     * bar to 00:00 JST, and it would then lose the staleness comparison
     * against any quote fetched later the same day.
     */
    let priced = false
    const priceStartedAt = performance.now()
    try {
      priced = await cacheFeedClose({
        instrumentId,
        assetClass,
        close: indicators.close,
        asOf: new Date(),
        tradingDay,
      })
    } catch (error) {
      // The likely cause is the `price_source` enum missing 'FEED', i.e.
      // drizzle/0004 not yet applied, so the message says so.
      const fault = error instanceof Error ? error.message : String(error)
      console.error(
        `[tv] bar stored, price not published for ${symbol}: ${fault}` +
          ' — is drizzle/0004_price_source_feed.sql applied?',
      )
      reportError(error, { route: TV_WEBHOOK_ROUTE, symbol, tradingDay })
    }
    const priceDurationMs = Math.round(performance.now() - priceStartedAt)
    const totalDurationMs = Math.round(performance.now() - acceptedAt)

    // The measurement is the answer to "is anything arriving and landing at
    // all" — every processed delivery, counted and timed, billed against the
    // metric quota rather than the error budget.
    const outcome: FeedDeliveryOutcome = 'STORED'
    reportMeasurement('tv_webhook.process_duration', totalDurationMs, 'millisecond', {
      outcome,
      storeDurationMs,
      priceDurationMs,
      priced,
    })

    const report = feedDeliveryReport(outcome, totalDurationMs)
    const tags = {
      route: TV_WEBHOOK_ROUTE,
      ticker,
      exchange,
      symbol,
      tradingDay,
      backfilled,
      storeDurationMs,
      priceDurationMs,
      priced,
    }
    if (report.channel === 'warning') {
      reportWarning(report.message, tags, report.fingerprint)
    } else {
      breadcrumb(report.message, tags)
    }
  } catch (error) {
    /*
     * Nothing upstream is waiting on this any more. Before the response moved
     * earlier, a throw here surfaced as a 5xx and TradingView retried it; now
     * it has to report itself or it vanishes into an unhandled rejection that
     * Fluid Compute logs and nothing else sees.
     */
    console.error(
      `[tv] deferred processing failed for ${ticker}: ` +
        (error instanceof Error ? error.message : String(error)),
    )
    reportError(error, { route: TV_WEBHOOK_ROUTE, ticker, phase: 'deferred' })
  }
}

export const Route = createFileRoute('/api/tv/$secret')({
  server: {
    handlers: {
      /**
       * Health check, so the URL can be confirmed from a browser before an alert
       * is wired to it. Reports nothing beyond "the secret is right".
       */
      GET: ({ params }: { params: { secret: string } }) =>
        authorise(params.secret, 'GET') ?? json({ ok: true, endpoint: 'exit-rules feed' }, 200),

      POST: async ({
        request,
        params,
      }: {
        request: Request
        params: { secret: string }
      }): Promise<Response> => {
        const denied = authorise(params.secret, 'POST')
        if (denied) return denied

        /*
         * The clock starts once the secret is accepted. Deliberately after
         * `authorise`: a wrong secret costs nothing beyond the comparison that
         * refused it.
         *
         * Everything from here to the response does no *database* I/O, on
         * purpose — just reading the request body and running it through a
         * JSON parse and a schema check. TradingView gives this
         * route 3s to answer; storing the bar and publishing its price used to
         * sit inside that budget as two database round trips to a region a
         * continent away, and a burst of same-close alerts could queue behind
         * a stalled pool for longer than that. Neither can lose the delivery
         * any more, because neither runs before the response does — see
         * `processDelivery` below, which runs after via `waitUntil`.
         */
        const acceptedAt = performance.now()

        const parsed = parseFeedBody(await request.text())
        const acceptDurationMs = Math.round(performance.now() - acceptedAt)

        if (!parsed.ok) {
          // Logged as well as returned: TradingView shows delivery failures only
          // as a status code, so the reason has to be findable server-side.
          console.error(`[tv] rejected payload: ${parsed.error}`)
          const outcome: FeedDeliveryOutcome = 'INVALID_PAYLOAD'
          reportMeasurement('tv_webhook.accept_duration', acceptDurationMs, 'millisecond', {
            outcome,
          })
          const report = feedDeliveryReport(outcome, acceptDurationMs)
          // INVALID_PAYLOAD is always the 'warning' branch — see the same
          // check in `processDelivery` for why this isn't just asserted.
          if (report.channel === 'warning') {
            reportWarning(report.message, {
              route: TV_WEBHOOK_ROUTE,
              status: 400,
            }, report.fingerprint)
          }
          return json({ error: parsed.error }, 400)
        }

        const { ticker, exchange, time, ...indicators } = parsed.payload
        const resolvedExchange = exchange ?? null

        reportMeasurement('tv_webhook.accept_duration', acceptDurationMs, 'millisecond', {
          outcome: 'ACCEPTED',
        })
        // The number that now actually maps to TradingView's 3s limit — see
        // `SLOW_ACCEPT_MS`'s own header. The accept phase does no *database*
        // I/O, so crossing it points at a cold start, CPU contention, or a
        // slow client upload — never a slow query.
        if (acceptDurationMs > SLOW_ACCEPT_MS) {
          reportWarning('exit feed: slow accept', {
            route: TV_WEBHOOK_ROUTE,
            ticker,
            exchange: resolvedExchange,
            acceptDurationMs,
          }, [TV_WEBHOOK_ROUTE, 'slow-accept'])
        } else {
          breadcrumb('exit feed: accepted', {
            ticker,
            exchange: resolvedExchange,
            acceptDurationMs,
          })
        }

        waitUntil(
          processDelivery({
            ticker,
            exchange: resolvedExchange,
            time,
            indicators,
            acceptedAt,
          }),
        )

        return json({ ok: true, ticker }, 200)
      },
    },
  },
})
