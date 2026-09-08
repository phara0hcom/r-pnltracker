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

/**
 * Below this, a token is short enough to be worth guessing, and the endpoint
 * refuses to serve at all rather than pretending to be protected.
 */
export const MIN_SECRET_LENGTH = 24

/**
 * Whether the configured secret is long enough for the endpoint to serve.
 *
 * Shared with the Exit Rules screen on purpose. The route 503s a secret that is
 * merely too short, so a screen that only checked "is it set" would suppress the
 * "not configured" warning while every payload was being silently rejected.
 */
export const webhookSecretUsable = (secret: string | undefined): secret is string =>
  secret !== undefined && secret.length >= MIN_SECRET_LENGTH

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
  return formatterFor(zone).format(new Date(timeMs))
}

/**
 * One `Intl.DateTimeFormat` per zone, built once.
 *
 * Constructing one is not free — it resolves a locale and a timezone database
 * entry — and there are exactly two zones in play for the life of the process.
 * The webhook builds a date on every delivery and every alert of the day fires
 * within the same second, so this is on the hot path rather than beside it.
 */
const formatters = new Map<string, Intl.DateTimeFormat>()

function formatterFor(zone: string): Intl.DateTimeFormat {
  const cached = formatters.get(zone)
  if (cached) return cached

  // `en-CA` renders as YYYY-MM-DD, which is the shape stored everywhere else.
  const made = new Intl.DateTimeFormat('en-CA', {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
  formatters.set(zone, made)
  return made
}

/**
 * The session date under each zone the bar could belong to.
 *
 * `zoneFor` needs the instrument's asset class, and the database is the only
 * thing that holds it — so resolving the day used to require a round trip
 * before the bar could even be written. Both answers are cheap to compute here,
 * and the insert then picks between them in SQL from the row it has already
 * resolved, which is what collapses the lookup and the write into one
 * statement.
 *
 * Derived by asking `zoneFor` itself under each asset class rather than
 * restating its rules: when TradingView names a venue the zone is settled
 * without the asset class at all, and both fields hold the same day.
 */
export interface TradingDayCandidates {
  /** The day for an instrument whose fallback zone is Asia/Tokyo. */
  jp: string
  /** The day for a US equity, whose fallback zone is America/New_York. */
  us: string
}

export function tradingDayCandidates(
  timeMs: number,
  exchange: string | null,
): TradingDayCandidates {
  return {
    jp: tradingDayFor(timeMs, zoneFor(exchange, 'JP_EQUITY')),
    us: tradingDayFor(timeMs, zoneFor(exchange, 'US_EQUITY')),
  }
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

/**
 * The largest instant `Date` can represent, per ECMA-262 — ±8.64e15 ms, about
 * ±273,790 years around the epoch. Past it every date operation is silently an
 * Invalid Date until something formats one and throws.
 */
const MAX_TIME_MS = 8.64e15

export const feedPayloadSchema = z.object({
  ticker: z.string().trim().min(1).max(128),
  exchange: z.string().trim().max(32).optional(),
  /** Bar open, Unix milliseconds. */
  time: z
    .union([z.number().int().positive(), z.string().regex(/^\d+$/)])
    .transform(Number)
    // Checked after the transform because `.positive()` guards the number branch
    // only: the string branch matches "0", and a long enough run of digits parses
    // to Infinity. Either one files a bar at an impossible date instead of being
    // rejected — "0" lands it on 1970-01-01, where it matches no plan ever.
    //
    // The upper bound is the same guard for the same reason, and the one the
    // finite check does not cover: a value between `MAX_TIME_MS` and
    // `Number.MAX_VALUE` is finite and positive, so it passes into
    // `tradingDayFor`, where `new Date()` is an Invalid Date and `Intl` throws.
    // On this route that would surface as an uncaught 500 rather than the 400
    // this rejection produces — and TradingView retries a 5xx, so a payload
    // that can never succeed would be redelivered.
    .refine(
      (value) => Number.isFinite(value) && value > 0 && value <= MAX_TIME_MS,
      'bar time must be positive and within the representable date range',
    ),
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
