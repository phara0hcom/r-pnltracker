/**
 * TradingView webhook for the playbook — OHLC candles on any timeframe.
 *
 * Added to a chart after a trade is opened, so the review can be drawn from
 * the bars that were actually on screen. The Pine script (docs/playbook.md)
 * resends its last 30 bars on every bar close: the first delivery brings the
 * structure *before* the entry, and every later one overlaps the last, so a
 * missed alert heals itself.
 *
 * Same secret, same trade-offs and the same shape as `/api/tv/$secret` — read
 * that file's header. What this one can reach is narrower: it appends candles
 * to `candle_bars`, which nothing outside the playbook reads, and it publishes
 * no price. A leaked secret can draw wrong charts into future captures, never
 * move a figure.
 *
 * No `authed`, for the reason the exit feed has none: TradingView is not a
 * browser, and candles are market data. CSRF does not apply either — see the
 * `filter` in `src/start.ts`, which only guards server functions.
 */
import { createHash, timingSafeEqual } from 'node:crypto'
import { createFileRoute } from '@tanstack/react-router'
import { waitUntil } from '@vercel/functions'
import { storeCandles } from '~/db/candles.service'
import { webhookSecretUsable } from '~/lib/exit/webhook'
import { reportError, reportMeasurement, reportWarning } from '~/lib/observability/report'
import { parseCandleBody, type CandleDelivery } from '~/lib/playbook/candles'

const ROUTE = 'candle-webhook'

const json = (body: unknown, status: number): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  })

/** Over digests, so unequal lengths compare in constant time too — as in the exit feed. */
function secretMatches(provided: string, expected: string): boolean {
  const a = createHash('sha256').update(provided).digest()
  const b = createHash('sha256').update(expected).digest()
  return timingSafeEqual(a, b)
}

/**
 * 503 when the feed is off, 404 for a wrong secret.
 *
 * Unreported, unlike the exit feed's refusals: that route already raises a
 * once-per-instance warning for an unset or rotated secret, and the two share
 * it, so a second report here would only say the same thing twice.
 */
function authorise(secret: string): Response | null {
  const expected = process.env.TRADINGVIEW_WEBHOOK_SECRET
  if (!webhookSecretUsable(expected)) return json({ error: 'webhook not configured' }, 503)
  if (!secretMatches(secret, expected)) return json({ error: 'not found' }, 404)
  return null
}

/** After the response, like the exit feed — TradingView gives a webhook 3s. */
async function processDelivery(delivery: CandleDelivery, acceptedAt: number): Promise<void> {
  try {
    const stored = await storeCandles(delivery)
    reportMeasurement(
      'candle_webhook.process_duration',
      Math.round(performance.now() - acceptedAt),
      'millisecond',
      {
        interval: delivery.interval,
        bars: stored,
      },
    )
  } catch (error) {
    console.error(
      `[candles] store failed for ${delivery.ticker} ${delivery.interval}: ` +
        (error instanceof Error ? error.message : String(error)),
    )
    reportError(error, { route: ROUTE, ticker: delivery.ticker, interval: delivery.interval })
  }
}

export const Route = createFileRoute('/api/candles/$secret')({
  server: {
    handlers: {
      /** Health check, so the URL can be confirmed before an alert is wired to it. */
      GET: ({ params }: { params: { secret: string } }) =>
        authorise(params.secret) ?? json({ ok: true, endpoint: 'playbook candles' }, 200),

      POST: async ({
        request,
        params,
      }: {
        request: Request
        params: { secret: string }
      }): Promise<Response> => {
        const denied = authorise(params.secret)
        if (denied) return denied

        const acceptedAt = performance.now()
        const parsed = parseCandleBody(await request.text())
        if (!parsed.ok) {
          // TradingView shows only the status, so the reason has to be findable here.
          console.error(`[candles] rejected payload: ${parsed.error}`)
          reportWarning('candle feed: payload rejected', { route: ROUTE, status: 400 }, [
            ROUTE,
            'invalid-payload',
          ])
          return json({ error: parsed.error }, 400)
        }

        waitUntil(processDelivery(parsed.delivery, acceptedAt))
        return json(
          {
            ok: true,
            ticker: parsed.delivery.ticker,
            interval: parsed.delivery.interval,
            bars: parsed.delivery.bars.length,
          },
          200,
        )
      },
    },
  },
})
