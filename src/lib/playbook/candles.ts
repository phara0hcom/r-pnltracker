/**
 * Candles for the playbook: the webhook payload, timeframes, windows, and
 * Yahoo's chart response.
 *
 * Pure, like `lib/exit/webhook.ts` — the awkward parts are which day a bar
 * belongs to, how far back each source reaches, and Pine's number formatting,
 * and all three are worth testing without a server or a network.
 */
import Decimal from 'decimal.js'
import { z } from 'zod'
import type { AssetClass } from '../domain/types'
import { repairPineJson, tradingDayFor, zoneFor } from '../exit/webhook'
import { tradingViewSymbol } from '../tradingview'
import type { Candle } from './types'

// ── Timeframes ──────────────────────────────────────────────────────────────

const MINUTE = 60_000
const DAY = 24 * 60 * MINUTE

/**
 * The one spelling a timeframe is stored under.
 *
 * TradingView names timeframes several ways depending on where it is read:
 * `{{interval}}` and `timeframe.period` give `5`, `60`, `240`, `D` or `1D`,
 * `W`, `M`. A chart captured from the 1-hour alert has to find the bars that
 * alert stored, so all of them collapse to `5m`, `1h`, `4h`, `1D`, `1W`, `1M`.
 * Seconds charts are refused: nothing here is held for seconds.
 */
export function normalizeInterval(raw: string): string | null {
  const value = raw.trim()
  const canonical = /^([1-9]\d{0,3})(m|h|D|W|M)$/.exec(value)
  if (canonical) return value

  const tv = /^([1-9]\d{0,3})?([DWM])?$/i.exec(value)
  if (!tv || (tv[1] === undefined && tv[2] === undefined)) return null
  const count = Number(tv[1] ?? '1')
  const unit = tv[2]?.toUpperCase()
  if (unit) return `${String(count)}${unit}`
  // A bare number is minutes.
  return count % 60 === 0 ? `${String(count / 60)}h` : `${String(count)}m`
}

/** Nominal length of one bar. A month is taken as 31 days — only ever used to size a window. */
export function intervalMs(interval: string): number {
  const match = /^(\d+)(m|h|D|W|M)$/.exec(interval)
  if (!match) throw new Error(`not a normalized interval: ${interval}`)
  const count = Number(match[1])
  switch (match[2] as 'm' | 'h' | 'D' | 'W' | 'M') {
    case 'm':
      return count * MINUTE
    case 'h':
      return count * 60 * MINUTE
    case 'D':
      return count * DAY
    case 'W':
      return count * 7 * DAY
    case 'M':
      return count * 31 * DAY
  }
}

/** True below a day — where a bar's time of day, and so a fill's, matters. */
export const isIntraday = (interval: string): boolean => intervalMs(interval) < DAY

// ── Tickers ─────────────────────────────────────────────────────────────────

/**
 * The key a symbol's candles are stored under: what `syminfo.ticker` sends.
 *
 * That is the TradingView symbol without its venue — `7203` for `TSE:7203`,
 * and the dotted share class (`BRK.B`) TradingView uses. Null for a fund,
 * which TradingView does not chart and Yahoo does not quote by name.
 */
export function candleTicker(symbol: string, assetClass: AssetClass): string | null {
  const tv = tradingViewSymbol(symbol.trim().toUpperCase(), assetClass)
  if (tv === null) return null
  return tv.replace(/^[A-Z]+:/, '')
}

/** Yahoo's spelling: `7203.T` for 東証, `BRK-B` for a US share class. */
export function yahooSymbol(symbol: string, assetClass: AssetClass): string | null {
  const ticker = candleTicker(symbol, assetClass)
  if (ticker === null) return null
  return assetClass === 'JP_EQUITY' ? `${ticker}.T` : ticker.replace('.', '-')
}

// ── Webhook payload ─────────────────────────────────────────────────────────

/**
 * Bars per delivery. The Pine script resends its last 30 by default, which is
 * what heals a missed alert; the cap is what stops one leaked secret from
 * writing a year of minute bars in a single call.
 */
export const MAX_BARS_PER_DELIVERY = 100

/** See `lib/exit/webhook.ts` — past this every `Date` is invalid. */
const MAX_TIME_MS = 8.64e15

const price = z.union([z.number(), z.string().trim().min(1)]).transform((raw, ctx) => {
  try {
    const parsed = new Decimal(raw)
    // `na` arrives as NaN — a bar from before the symbol listed, say. Storing
    // it as zero would draw a wick to the floor.
    if (!parsed.isFinite() || parsed.lt(0)) throw new Error('not a price')
    return parsed.toString()
  } catch {
    ctx.addIssue({ code: 'custom', message: `not a price: ${String(raw)}` })
    return z.NEVER
  }
})

/** `na` volume is common on indices and FX, and is not a reason to drop the bar. */
const volume = z
  .union([z.number(), z.string(), z.null()])
  .optional()
  .transform((raw) => {
    if (raw == null || raw === '') return null
    try {
      const parsed = new Decimal(raw)
      return parsed.isFinite() && parsed.gte(0) ? parsed.toString() : null
    } catch {
      return null
    }
  })

/**
 * Unix milliseconds, or the ISO form `{{time}}` produces (`2026-10-20T00:00:00Z`)
 * — so a plain alert with no Pine at all can feed this too.
 */
const barTime = z.union([z.number(), z.string().trim().min(1)]).transform((raw, ctx) => {
  const ms = typeof raw === 'number' || /^\d+$/.test(raw) ? Number(raw) : Date.parse(raw)
  if (!Number.isFinite(ms) || ms <= 0 || ms > MAX_TIME_MS) {
    ctx.addIssue({ code: 'custom', message: `not a bar time: ${String(raw)}` })
    return z.NEVER
  }
  return ms
})

const tuple = z.tuple([barTime, price, price, price, price]).rest(volume)

const ohlc = z.object({
  time: barTime,
  open: price,
  high: price,
  low: price,
  close: price,
  volume,
})

const candlePayloadSchema = z.object({
  ticker: z.string().trim().min(1).max(64),
  exchange: z.string().trim().max(32).optional(),
  interval: z.string().trim().min(1).max(8),
  /** `[time, open, high, low, close, volume]`, as the Pine script sends them. */
  bars: z.array(tuple).min(1).max(MAX_BARS_PER_DELIVERY).optional(),
  /** Or one bar as named fields, for a plain alert built from placeholders. */
  ...ohlc.partial().shape,
})

export interface CandleDelivery {
  ticker: string
  exchange: string | null
  interval: string
  bars: Candle[]
}

export type CandleParseOutcome =
  { ok: true; delivery: CandleDelivery } | { ok: false; error: string }

/** A bar whose high is under its body, or whose low is over it, is corrupt, not unusual. */
function coherent(bar: Candle): boolean {
  const [o, h, l, c] = [bar.o, bar.h, bar.l, bar.c].map((value) => new Decimal(value))
  return h!.gte(Decimal.max(o!, c!)) && l!.lte(Decimal.min(o!, c!))
}

export function parseCandleBody(body: string): CandleParseOutcome {
  let json: unknown
  try {
    json = JSON.parse(repairPineJson(body))
  } catch {
    return { ok: false, error: 'body is not valid JSON' }
  }

  const result = candlePayloadSchema.safeParse(json)
  if (!result.success) {
    const first = result.error.issues[0]
    const path = first?.path.join('.') ?? 'payload'
    return { ok: false, error: `${path || 'payload'}: ${first?.message ?? 'invalid'}` }
  }
  const payload = result.data

  const interval = normalizeInterval(payload.interval)
  if (interval === null)
    return { ok: false, error: `interval: not a timeframe: ${payload.interval}` }

  let bars: Candle[]
  if (payload.bars) {
    bars = payload.bars.map(([t, o, h, l, c, v]) => ({ t, o, h, l, c, v: v ?? null }))
  } else {
    const single = ohlc.safeParse(payload)
    if (!single.success)
      return { ok: false, error: 'payload: needs `bars`, or time/open/high/low/close' }
    const { time, open, high, low, close } = single.data
    bars = [{ t: time, o: open, h: high, l: low, c: close, v: single.data.volume }]
  }

  const broken = bars.find((bar) => !coherent(bar))
  if (broken)
    return { ok: false, error: `bars: high/low do not contain the body at ${String(broken.t)}` }

  return {
    ok: true,
    delivery: {
      // Upper-cased so `aapl` from a hand-typed alert files with `AAPL`.
      ticker: payload.ticker.toUpperCase(),
      exchange: payload.exchange ?? null,
      interval,
      bars: dedupeSorted(bars),
    },
  }
}

/** Oldest first, one bar per open time — the later copy wins, as the upsert would. */
export function dedupeSorted(bars: readonly Candle[]): Candle[] {
  const byTime = new Map<number, Candle>()
  for (const bar of bars) byTime.set(bar.t, bar)
  return [...byTime.values()].sort((a, b) => a.t - b.t)
}

// ── Exchange-local time ─────────────────────────────────────────────────────

/** The zone a symbol's sessions are dated in. */
export const zoneOf = (assetClass: AssetClass): string => zoneFor(null, assetClass)

/** Offset of `zone` from UTC at an instant, in ms. */
function offsetMs(instant: number, zone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(instant))
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value)
  const asUtc = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour'),
    get('minute'),
    get('second'),
  )
  return asUtc - instant
}

/**
 * A wall-clock time on an exchange, as an instant.
 *
 * New York's offset depends on the date, so it is read from the zone database
 * rather than assumed — and read twice, because the first guess can sit on the
 * wrong side of a daylight-saving change.
 */
export function zonedInstant(date: string, time: string, zone: string): number {
  const [y, m, d] = date.split('-').map(Number)
  const [hh, mm] = time.split(':').map(Number)
  const wall = Date.UTC(y!, m! - 1, d, hh ?? 0, mm ?? 0)
  const first = wall - offsetMs(wall, zone)
  return wall - offsetMs(first, zone)
}

/** The session date a bar falls on, where the exchange is. */
export const barDay = (bar: Candle, zone: string): string => tradingDayFor(bar.t, zone)

// ── Windows ─────────────────────────────────────────────────────────────────

/** How much of the chart is before the fill: the structure the entry was judged on. */
export const BARS_BEFORE = 60
/** And after it — for an exit, whether leaving was right. */
export const BARS_AFTER = 30

/**
 * Where a fill sits on a chart.
 *
 * With a time, it is the bar that contains it. Without one — the usual case,
 * since no export records an execution time — an intraday chart can only say
 * which *day* it was, so it marks that day's bars as a span rather than
 * pretending to know the bar. A daily or longer chart needs no time: the bar
 * covering the date is the fill.
 */
export type Placement = { kind: 'bar'; index: number } | { kind: 'span'; from: number; to: number }

export function placeFill(
  bars: readonly Candle[],
  interval: string,
  fill: { date: string; time: string | null },
  zone: string,
): Placement | null {
  if (bars.length === 0) return null

  if (isIntraday(interval)) {
    if (fill.time !== null) {
      const at = zonedInstant(fill.date, fill.time, zone)
      const width = intervalMs(interval)
      const index = bars.findIndex((bar) => bar.t <= at && at < bar.t + width)
      if (index >= 0) return { kind: 'bar', index }
    }
    const indices = bars.flatMap((bar, i) => (barDay(bar, zone) === fill.date ? [i] : []))
    if (indices.length === 0) return null
    return { kind: 'span', from: indices[0]!, to: indices[indices.length - 1]! }
  }

  // The last bar opening on or before the date — a weekly bar opens on Monday.
  let index = -1
  for (let i = 0; i < bars.length; i++) {
    if (barDay(bars[i]!, zone) <= fill.date) index = i
    else break
  }
  if (index < 0) return null
  // Past the end of a covered range is not "in" the last bar.
  const last = bars[index]!
  if (fill.date > tradingDayFor(last.t + intervalMs(interval) - 1, zone)) return null
  return { kind: 'bar', index }
}

/** The instant a fill is centred on: its time if known, otherwise the end of its day. */
export function fillInstant(fill: { date: string; time: string | null }, zone: string): number {
  return zonedInstant(fill.date, fill.time ?? '23:59', zone)
}

/**
 * The bars a chart keeps: `before` up to the fill and `after` beyond it,
 * stretched to cover every other fill of the review between the two ends.
 */
export function windowAround(
  bars: readonly Candle[],
  from: number,
  to: number,
  before = BARS_BEFORE,
  after = BARS_AFTER,
): Candle[] {
  const sorted = dedupeSorted(bars)
  let first = sorted.findIndex((bar) => bar.t > from)
  if (first < 0) first = sorted.length
  let last = sorted.findIndex((bar) => bar.t > to)
  if (last < 0) last = sorted.length
  return sorted.slice(Math.max(0, first - before), Math.min(sorted.length, last + after))
}

// ── Yahoo ───────────────────────────────────────────────────────────────────

/**
 * Yahoo's interval names, and how far back each one goes.
 *
 * The limits are Yahoo's, observed rather than documented: minute bars for 30
 * days (7 per request), up to 30-minute bars for 60, hourly for 730. Asking
 * past them returns an error body, so the request is refused here with the
 * reason instead. Four-hour bars do not exist on Yahoo at all.
 */
const YAHOO: Record<string, { name: string; reachDays: number | null; spanDays?: number }> = {
  '1m': { name: '1m', reachDays: 29, spanDays: 7 },
  '2m': { name: '2m', reachDays: 59 },
  '5m': { name: '5m', reachDays: 59 },
  '15m': { name: '15m', reachDays: 59 },
  '30m': { name: '30m', reachDays: 59 },
  '1h': { name: '60m', reachDays: 729 },
  '1D': { name: '1d', reachDays: null },
  '1W': { name: '1wk', reachDays: null },
  '1M': { name: '1mo', reachDays: null },
}

export type YahooRequest = { ok: true; url: string } | { ok: false; error: string }

/**
 * Calendar time that holds `bars` bars: sessions are 5–6.5 hours and markets
 * close at weekends, so an intraday bar count needs several times its nominal
 * span. Generous on purpose — `windowAround` trims the excess.
 */
function spanFor(interval: string, bars: number): number {
  const nominal = intervalMs(interval) * bars
  return isIntraday(interval) ? nominal * 5 + 4 * DAY : nominal * 1.6 + 7 * DAY
}

export function yahooRequest(
  symbol: string,
  assetClass: AssetClass,
  interval: string,
  from: number,
  to: number,
  now: number,
): YahooRequest {
  const ticker = yahooSymbol(symbol, assetClass)
  if (ticker === null) return { ok: false, error: `Yahoo has no chart for ${symbol}` }
  const spec = YAHOO[interval]
  if (!spec)
    return { ok: false, error: `Yahoo has no ${interval} bars — use the TradingView alert` }

  let period1 = from - spanFor(interval, BARS_BEFORE)
  let period2 = Math.min(now, to + spanFor(interval, BARS_AFTER))

  if (spec.reachDays !== null) {
    const floor = now - spec.reachDays * DAY
    if (to < floor) {
      return {
        ok: false,
        error: `Yahoo keeps ${interval} bars for ${String(spec.reachDays + 1)} days only — use the TradingView alert or a longer timeframe`,
      }
    }
    period1 = Math.max(period1, floor)
  }
  if (spec.spanDays !== undefined && period2 - period1 > spec.spanDays * DAY) {
    period1 = Math.max(period1, period2 - spec.spanDays * DAY)
  }
  if (period2 <= period1) period2 = period1 + intervalMs(interval)

  const params = new URLSearchParams({
    interval: spec.name,
    period1: String(Math.floor(period1 / 1000)),
    period2: String(Math.ceil(period2 / 1000)),
    includePrePost: 'false',
  })
  return {
    ok: true,
    url: `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?${params.toString()}`,
  }
}

const yahooSchema = z.object({
  chart: z.object({
    result: z
      .array(
        z.object({
          timestamp: z.array(z.number()).optional(),
          indicators: z.object({
            quote: z.array(
              z.object({
                open: z.array(z.number().nullable()).optional(),
                high: z.array(z.number().nullable()).optional(),
                low: z.array(z.number().nullable()).optional(),
                close: z.array(z.number().nullable()).optional(),
                volume: z.array(z.number().nullable()).optional(),
              }),
            ),
          }),
        }),
      )
      .nullable(),
  }),
})

/**
 * Yahoo's floats, as exact strings.
 *
 * Yahoo serialises prices as binary floats — `172.88999938964844` — so they
 * are cut to four places, past any tick either market uses, before they join
 * the decimal-only world everything else lives in.
 */
const fromFloat = (value: number): string => new Decimal(value).toDecimalPlaces(4).toString()

/** Bars from a chart response; a slot with any price missing is a gap, not a zero. */
export function parseYahooChart(json: unknown): Candle[] {
  const parsed = yahooSchema.safeParse(json)
  const result = parsed.success ? parsed.data.chart.result?.[0] : undefined
  if (!result?.timestamp) return []
  const quote = result.indicators.quote[0]
  if (!quote) return []

  const bars: Candle[] = []
  result.timestamp.forEach((seconds, i) => {
    const o = quote.open?.[i]
    const h = quote.high?.[i]
    const l = quote.low?.[i]
    const c = quote.close?.[i]
    if (o == null || h == null || l == null || c == null) return
    const v = quote.volume?.[i]
    bars.push({
      t: seconds * 1000,
      o: fromFloat(o),
      // Rounding can put a high a hair under the body; widen rather than reject.
      h: fromFloat(Math.max(h, o, c)),
      l: fromFloat(Math.min(l, o, c)),
      c: fromFloat(c),
      v: v == null ? null : String(Math.round(v)),
    })
  })
  return dedupeSorted(bars)
}
