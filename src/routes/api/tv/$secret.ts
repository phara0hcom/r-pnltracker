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
import { instruments } from '~/db/schema'
import { parseFeedBody, tradingDayFor, zoneFor } from '~/lib/exit/webhook'

/**
 * Below this, a token is short enough to be worth guessing, and the endpoint
 * refuses to serve at all rather than pretending to be protected.
 */
const MIN_SECRET_LENGTH = 24

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

  if (!expected || expected.length < MIN_SECRET_LENGTH) {
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

        await recordFeedBar({
          instrumentId: instrument.id,
          tradingDay,
          barTime: new Date(time),
          exchange: exchange ?? null,
          ...indicators,
        })

        // If a plan was created before its entry-day bar existed, this is the
        // moment that gap closes.
        const backfilled = await backfillEntryAtrForBar(instrument.id, tradingDay, indicators.atr14)

        return json({ ok: true, symbol: instrument.symbol, tradingDay, backfilled }, 200)
      },
    },
  },
})
