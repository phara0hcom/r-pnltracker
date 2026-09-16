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
import { storeFeedBar, type FeedDeliveryOutcome } from '~/db/exit.service'
import { cacheFeedClose } from '~/db/prices.service'
import {
  MIN_SECRET_LENGTH,
  parseFeedBody,
  tradingDayCandidates,
  webhookSecretUsable,
} from '~/lib/exit/webhook'
import {
  feedDeliveryReport,
  TV_WEBHOOK_ROUTE,
} from '~/lib/observability/feedDelivery'
import {
  breadcrumb,
  reportError,
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
         * The clock starts once the secret is accepted.
         *
         * Deliberately after `authorise`: a wrong secret costs nothing beyond
         * the comparison that refused it.
         */
        const startedAt = performance.now()

        /** Reports the outcome, then answers. Reporting never fails the request. */
        const finish = (
          status: number,
          outcome: FeedDeliveryOutcome,
          body: Record<string, unknown>,
          subject: { ticker?: string; exchange?: string | null } = {},
        ): Response => {
          const durationMs = Math.round(performance.now() - startedAt)

          /*
           * The measurement is the answer to "is anything arriving at all" —
           * every delivery, counted and timed, billed against the metric quota
           * rather than the error budget. It is the same instrument
           * `server_fn.duration` gives every server function, which this route
           * has never had: the alarm in `src/start.ts` is function middleware
           * and a route handler never runs it.
           *
           * Nothing here is wrapped because nothing here can throw: `report.ts`
           * guarantees that of all four functions, and `feedDeliveryReport` is
           * pure.
           */
          reportMeasurement('tv_webhook.duration', durationMs, 'millisecond', {
            outcome,
            status,
          })

          const report = feedDeliveryReport(outcome, durationMs)
          // Ticker and exchange only. Tags are indexed and searchable, so what
          // goes in them is a decision rather than whatever the call site had.
          const tags = {
            route: TV_WEBHOOK_ROUTE,
            outcome,
            status,
            durationMs,
            ticker: subject.ticker ?? null,
            exchange: subject.exchange ?? null,
          }

          if (report.channel === 'warning') {
            reportWarning(report.message, tags, report.fingerprint)
          } else {
            breadcrumb(report.message, tags)
          }

          return json(body, status)
        }

        const parsed = parseFeedBody(await request.text())
        if (!parsed.ok) {
          // Logged as well as returned: TradingView shows delivery failures only
          // as a status code, so the reason has to be findable server-side.
          console.error(`[tv] rejected payload: ${parsed.error}`)
          return finish(400, 'INVALID_PAYLOAD', { error: parsed.error })
        }

        const { ticker, exchange, time, ...indicators } = parsed.payload

        /*
         * Two statements for the work, and deliberately not five.
         *
         * Every alert of the day fires at the same close, so this route is only
         * ever hit in bursts — one delivery per open position, all at once.
         * Each round trip is paid per delivery against a database on another
         * continent (~75ms; see the region note in `vite.config.ts`) and holds
         * a pooled connection for the whole of it, so the number of statements,
         * not the work inside them, is what decides how many alerts can land
         * together. Resolving the instrument, upserting the bar and backfilling
         * the entry ATR are therefore one statement, and publishing the close
         * is the other.
         */
        const stored = await storeFeedBar({
          ticker,
          // Both candidates, because which one applies depends on the asset
          // class — which the statement below resolves and picks with.
          tradingDay: tradingDayCandidates(time, exchange ?? null),
          barTime: new Date(time),
          exchange: exchange ?? null,
          ...indicators,
        })

        if (!stored) {
          // Not an error worth retrying: an alert exists for something this
          // account has never traded, so there is nothing to attach a bar to.
          console.error(`[tv] no instrument for ticker ${ticker} — bar discarded`)
          return finish(404, 'UNKNOWN_TICKER', { error: `unknown instrument ${ticker}` }, {
            ticker,
            exchange: exchange ?? null,
          })
        }

        const { symbol, tradingDay, backfilled } = stored

        /*
         * The close is also the best price anyone has for this instrument at
         * the moment it lands. The alert fires *at* the daily close, whereas
         * the quote providers are polled only when someone asks — so without
         * this, Positions could show a staler figure than the Exit Rules card
         * beside it, sourced from the same instrument minutes earlier.
         *
         * Only when the bar is the newest one held: a replayed bar carries an
         * old trading day, and an old close must not become the current price.
         * That test lives inside the write now rather than in a statement of
         * its own — it is a condition on the row, so asking it separately cost
         * a round trip and still left a gap for a later bar to commit in.
         *
         * `asOf` is delivery time, not the payload's `time`, which is the bar's
         * *open*. Filing a close under its opening timestamp would date every
         * JP bar to 00:00 JST, and it would then lose the `setWhere` comparison
         * against any quote fetched later the same day — the price would be
         * correct and permanently unable to publish itself.
         */
        /*
         * Fired, not awaited — and this is the whole of "answer as soon as the
         * data is good".
         *
         * The bar above is the job, so the response waits for it: answering
         * first and storing after would mean a delivery TradingView believes
         * landed, with nothing to retry it, if the instance is frozen before
         * the write commits. Publishing the close is the opposite kind of work.
         * It was already a bonus — the `catch` it used to have exists because a
         * pricing fault must never 5xx a bar that is safely stored — so the
         * worst a dropped one costs is that Positions reads a slightly staler
         * price until a quote provider is next polled.
         *
         * That leaves one round trip on the answer instead of three: the
         * delivery-log row is gone with the screen that read it, and this one
         * no longer holds the response open. At ~75ms each against Neon (see
         * the region note in `vite.config.ts`), and with every alert of the day
         * firing into the same burst, that is the difference between alerts
         * that answer in time and alerts TradingView abandons.
         *
         * `.catch` is not optional. An unawaited rejection is an
         * `unhandledRejection`, which is the same shape of fault as the pool
         * error that was killing this instance — see `src/db/index.ts`.
         *
         * `asOf` is delivery time, not the payload's `time`, which is the bar's
         * *open*. Filing a close under its opening timestamp would date every
         * JP bar to 00:00 JST, and it would then lose the `setWhere` comparison
         * against any quote fetched later the same day — the price would be
         * correct and permanently unable to publish itself.
         */
        void cacheFeedClose({
          instrumentId: stored.instrumentId,
          assetClass: stored.assetClass,
          close: indicators.close,
          asOf: new Date(),
          tradingDay,
        }).catch((error: unknown) => {
          /*
           * The likely cause is the `price_source` enum missing 'FEED', i.e.
           * drizzle/0004 not yet applied, so the message says so. Reported as
           * well as logged: the symptom it produces is a stale badge, which
           * looks like nothing happening, and the console is not somewhere
           * anyone looks — which is how this could fail quietly for a week.
           */
          const fault = error instanceof Error ? error.message : String(error)
          console.error(
            `[tv] bar stored, price not published for ${symbol}: ${fault}` +
              ' — is drizzle/0004_price_source_feed.sql applied?',
          )
          reportError(error, { route: TV_WEBHOOK_ROUTE, symbol, tradingDay })
        })

        /*
         * `priced` is deliberately absent from the body: the publish above has
         * not resolved yet and nothing reads this body anyway — TradingView
         * discards it, and the GET health check has its own.
         */
        return finish(200, 'STORED', { ok: true, symbol, tradingDay, backfilled }, {
          ticker,
          exchange: exchange ?? null,
        })
      },
    },
  },
})
