/**
 * Parsing for the TradingView alert payload.
 *
 * Kept pure and separate from the route because the two genuinely difficult
 * parts — deciding which calendar day a bar belongs to, and surviving Pine's
 * number formatting — are exactly the parts worth testing without standing up
 * an HTTP server.
 */
import Decimal from 'decimal.js'
import { z } from 'zod'
import type { AssetClass } from '../domain/types'

/**
 * Exchange codes `syminfo.exchange` emits, mapped to the zone their session
 * dates are expressed in.
 *
 * Only the venues this tracker can hold are listed; anything else falls back to
 * the instrument's asset class, which the app already knows for certain.
 */
const EXCHANGE_ZONES: Record<string, string> = {
  TSE: 'Asia/Tokyo',
  TYO: 'Asia/Tokyo',
  JPX: 'Asia/Tokyo',
  NASDAQ: 'America/New_York',
  NYSE: 'America/New_York',
  AMEX: 'America/New_York',
  ARCA: 'America/New_York',
  BATS: 'America/New_York',
  CBOE: 'America/New_York',
}

/** The timezone a bar's session date should be read in. */
export function zoneFor(exchange: string | null, assetClass: AssetClass): string {
  const mapped = exchange === null ? undefined : EXCHANGE_ZONES[exchange.toUpperCase()]
  if (mapped) return mapped
  return assetClass === 'US_EQUITY' ? 'America/New_York' : 'Asia/Tokyo'
}

/**
 * The calendar day a bar belongs to, in the exchange's own timezone.
 *
 * TradingView sends `time` as the bar's opening instant in UTC milliseconds. For
 * a 東証 daily bar that instant is midnight JST, which is 15:00 UTC the *previous*
 * day — so reading it with `toISOString()` shifts every JP bar back one day and
 * silently breaks both the entry-ATR lookup and the staleness count. Formatting
 * in the exchange's zone is what makes the date mean what the chart shows.
 */
export function tradingDayFor(timeMs: number, zone: string): string {
  // `en-CA` renders as YYYY-MM-DD, which is the shape stored everywhere else.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(timeMs))
}

/**
 * Repairs the two ways Pine's `str.tostring` can emit text that is not valid
 * JSON, before it ever reaches `JSON.parse`.
 *
 * A `"#.##"` format pattern treats every `#` as an *optional* digit, so a value
 * below 1 can serialise with no leading zero — `,"macd":.0123` or `-.0123`.
 * JSON requires a digit before the point, so the whole payload would otherwise
 * be rejected for a reason that has nothing to do with the data. MACD lines sit
 * near zero constantly, so this is the common case, not a corner.
 */
export function repairPineJson(body: string): string {
  return body.replace(/([:[,]\s*)(-?)\.(\d)/g, '$1$20.$3')
}

/**
 * Accepts a number or a numeric string, and keeps the exact text.
 *
 * Stored as a string rather than a JS number because these land in
 * `numeric(24,8)` columns and are compared as `Decimal`. Round-tripping a price
 * through a float first would be the one place in this codebase that does it.
 */
const numeric = z.union([z.number(), z.string().trim().min(1)]).transform((raw, ctx) => {
  try {
    const parsed = new Decimal(raw)
    // `na` from an indicator that has not warmed up arrives as NaN. Storing it
    // would poison the momentum window and the ATR lookup, so the bar is
    // rejected outright rather than written as zero.
    if (!parsed.isFinite()) throw new Error('not finite')
    return parsed.toString()
  } catch {
    ctx.addIssue({ code: 'custom', message: `not a finite number: ${String(raw)}` })
    return z.NEVER
  }
})

export const feedPayloadSchema = z.object({
  ticker: z.string().trim().min(1).max(128),
  exchange: z.string().trim().max(32).optional(),
  /** Bar open, Unix milliseconds. */
  time: z.union([z.number().int().positive(), z.string().regex(/^\d+$/)]).transform(Number),
  close: numeric,
  sma10: numeric,
  sma20: numeric,
  rsi14: numeric,
  macd: numeric,
  macdSignal: numeric,
  macdHist: numeric,
  atr14: numeric,
})

export type FeedPayload = z.infer<typeof feedPayloadSchema>

export type ParseOutcome =
  | { ok: true; payload: FeedPayload }
  | { ok: false; error: string }

/** Parses a raw request body, repairing Pine's formatting first. */
export function parseFeedBody(body: string): ParseOutcome {
  let json: unknown
  try {
    json = JSON.parse(repairPineJson(body))
  } catch {
    return { ok: false, error: 'body is not valid JSON' }
  }

  const result = feedPayloadSchema.safeParse(json)
  if (!result.success) {
    const first = result.error.issues[0]
    const path = first?.path.join('.') ?? 'payload'
    return { ok: false, error: `${path}: ${first?.message ?? 'invalid'}` }
  }

  return { ok: true, payload: result.data }
}
