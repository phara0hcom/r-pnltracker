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
import { eq } from 'drizzle-orm'
import { db } from '~/db'
import { backfillEntryAtrForBar, recordFeedBar } from '~/db/exit.service'
import { cacheFeedClose } from '~/db/prices.service'
import { instruments } from '~/db/schema'
import {
  MIN_SECRET_LENGTH,
  parseFeedBody,
  tradingDayFor,
  webhookSecretUsable,
  zoneFor,
} from '~/lib/exit/webhook'

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

/** Shared by both verbs — resolves the configured secret and checks the path. */
function authorise(secret: string): Response | null {
  const expected = process.env.TRADINGVIEW_WEBHOOK_SECRET

  // The same predicate the Exit Rules screen reports with, so a too-short secret
  // cannot 503 every payload while the screen shows the feed as configured.
  if (!webhookSecretUsable(expected)) {
    console.error(
      '[tv] TRADINGVIEW_WEBHOOK_SECRET is unset or shorter than ' +
        `${String(MIN_SECRET_LENGTH)} characters — refusing to accept webhooks.`,
    )
    return json({ error: 'webhook not configured' }, 503)
  }

  // 404 rather than 401: an unauthenticated prober learns nothing about whether
  // this path is a real endpoint.
  if (!secretMatches(secret, expected)) return json({ error: 'not found' }, 404)

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
        authorise(params.secret) ?? json({ ok: true, endpoint: 'exit-rules feed' }, 200),

      POST: async ({
        request,
        params,
      }: {
        request: Request
        params: { secret: string }
      }): Promise<Response> => {
        const denied = authorise(params.secret)
        if (denied) return denied

        const parsed = parseFeedBody(await request.text())
        if (!parsed.ok) {
          // Logged as well as returned: TradingView shows delivery failures only
          // as a status code, so the reason has to be findable server-side.
          console.error(`[tv] rejected payload: ${parsed.error}`)
          return json({ error: parsed.error }, 400)
        }

        const { ticker, exchange, time, ...indicators } = parsed.payload

        // The symbol is the tracker's own identity for the instrument: a 4-digit
        // code for 東証 names, the bare ticker for US ones — which is exactly what
        // `syminfo.ticker` emits for both.
        const [instrument] = await db
          .select()
          .from(instruments)
          .where(eq(instruments.symbol, ticker))

        if (!instrument) {
          // Not an error worth retrying: an alert exists for something this
          // account has never traded, so there is nothing to attach a bar to.
          console.error(`[tv] no instrument for ticker ${ticker} — bar discarded`)
          return json({ error: `unknown instrument ${ticker}` }, 404)
        }

        const tradingDay = tradingDayFor(time, zoneFor(exchange ?? null, instrument.assetClass))

        const { isLatest } = await recordFeedBar({
          instrumentId: instrument.id,
          tradingDay,
          barTime: new Date(time),
          exchange: exchange ?? null,
          ...indicators,
        })

        // If a plan was created before its entry-day bar existed, this is the
        // moment that gap closes.
        const backfilled = await backfillEntryAtrForBar(instrument.id, tradingDay, indicators.atr14)

        /*
         * The close is also the best price anyone has for this instrument at
         * the moment it lands. The alert fires *at* the daily close, whereas
         * the quote providers are polled only when someone asks — so without
         * this, Positions could show a staler figure than the Exit Rules card
         * beside it, sourced from the same instrument minutes earlier.
         *
         * Only when the bar is the newest one held: a replayed bar carries an
         * old trading day, and an old close must not become the current price.
         *
         * `asOf` is delivery time, not the payload's `time`, which is the bar's
         * *open*. Filing a close under its opening timestamp would date every
         * JP bar to 00:00 JST, and it would then lose the `setWhere` comparison
         * against any quote fetched later the same day — the price would be
         * correct and permanently unable to publish itself.
         */
        let priced = false
        if (isLatest) {
          try {
            priced = await cacheFeedClose({
              instrumentId: instrument.id,
              assetClass: instrument.assetClass,
              close: indicators.close,
              asOf: new Date(),
            })
          } catch (error) {
            /*
             * Publishing the price is a bonus; recording the bar is the job.
             * A throw here would 500 a request whose bar has already been
             * stored, and TradingView retries a 5xx — so a pricing fault would
             * present as the exit feed being down, which is the one failure
             * this feature most needs to report honestly.
             *
             * The likely cause is the `price_source` enum missing 'FEED',
             * i.e. drizzle/0004 not yet applied, so the message says so.
             */
            console.error(
              `[tv] bar stored, price not published for ${instrument.symbol}: ${
                error instanceof Error ? error.message : String(error)
              } — is drizzle/0004_price_source_feed.sql applied?`,
            )
          }
        }

        return json({ ok: true, symbol: instrument.symbol, tradingDay, backfilled, priced }, 200)
      },
    },
  },
})
