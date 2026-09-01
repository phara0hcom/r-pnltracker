/**
 * Geometry for the trade-distribution scatter: one circle per close, placed on
 * the day it closed (x) and its return on cost (y), with circle *area* carrying
 * the yen size of the gain or loss.
 *
 * The two encodings are deliberately different quantities. A +40% circle the
 * size of a pinhead is a good result on a tiny position, and seeing it next to
 * a +3% circle the size of a coin is the whole point of the chart — return and
 * contribution are not the same thing, and a table of either alone hides that.
 *
 * Both scales are fixed to the *whole dataset*, never to the visible window.
 * Rescaling per window would draw a quiet week's ¥3,000 win the same size as a
 * busy month's ¥300,000 one, which destroys the comparison paging through
 * periods exists to make. Same principle as `zeroBar`'s `maxPos`/`maxNeg`.
 *
 * Pure and DB-free like the rest of `lib` — dates and numbers in, percentages
 * and pixels out.
 */

const DAY_MS = 86_400_000

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const WEEKDAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

/**
 * Every date in this app is a plain `YYYY-MM-DD` calendar day with no zone, so
 * all the arithmetic here is done at UTC midnight. Parsing bare `2026-08-31`
 * would be UTC anyway, but the explicit suffix keeps it from depending on that.
 */
const toUtc = (iso: string): number => Date.parse(`${iso}T00:00:00Z`)
const toIso = (ms: number): string => new Date(ms).toISOString().slice(0, 10)

/** Monday-start, because a trading week reads Mon–Fri with the weekend trailing. */
const startOfWeek = (ms: number): number => ms - ((new Date(ms).getUTCDay() + 6) % 7) * DAY_MS

/**
 * A "nice" axis step — 1, 2, 2.5 or 5 times a power of ten.
 *
 * Dividing a range by a tick count directly gives values like 13.7%, which are
 * unreadable as axis labels. Snapping to these multiples keeps the gridlines on
 * round numbers a reader can anchor a circle's height against.
 */
export function niceStep(range: number, targetTicks: number): number {
  if (range <= 0 || targetTicks <= 0) return 0
  const raw = range / targetTicks
  const magnitude = 10 ** Math.floor(Math.log10(raw))
  const normalized = raw / magnitude
  const snapped =
    normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 2.5 ? 2.5 : normalized <= 5 ? 5 : 10
  return snapped * magnitude
}

// ── Windows ─────────────────────────────────────────────────────────────────

/** A calendar month on PC, a week on SP — the plot only has room for so many days. */
export type WindowUnit = 'month' | 'week'

export interface DateWindow {
  /** Inclusive first day, `YYYY-MM-DD`. */
  start: string
  /** Inclusive last day. */
  end: string
  /** Every day in the window, in order — one x coordinate each. */
  days: string[]
  /** Short label for the nav row: `Aug 2026`, `Aug 24 – 30`, `Aug 31 – Sep 6`. */
  label: string
}

function daysBetween(startMs: number, endMs: number): string[] {
  const days: string[] = []
  for (let ms = startMs; ms <= endMs; ms += DAY_MS) days.push(toIso(ms))
  return days
}

/** The calendar month `back` months before the month holding `anchor`. */
export function monthWindow(anchor: string, back: number): DateWindow {
  const at = new Date(toUtc(anchor))
  // `Date.UTC` normalises an out-of-range month index, so a negative one rolls
  // the year back on its own — no separate year arithmetic to get wrong.
  const startMs = Date.UTC(at.getUTCFullYear(), at.getUTCMonth() - back, 1)
  const start = new Date(startMs)
  // Day 0 of the *next* month is the last day of this one, which is also how
  // the calendar screen finds a month's length.
  const endMs = Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0)

  return {
    start: toIso(startMs),
    end: toIso(endMs),
    days: daysBetween(startMs, endMs),
    label: `${MONTH_NAMES[start.getUTCMonth()] ?? ''} ${String(start.getUTCFullYear())}`,
  }
}

/** The Mon–Sun week `back` weeks before the week holding `anchor`. */
export function weekWindow(anchor: string, back: number): DateWindow {
  const startMs = startOfWeek(toUtc(anchor)) - back * 7 * DAY_MS
  const endMs = startMs + 6 * DAY_MS
  const start = new Date(startMs)
  const end = new Date(endMs)

  // The month is repeated only when the week straddles one — `Aug 24 – 30`
  // rather than `Aug 24 – Aug 30`, which is the label that has to fit on a
  // 390px screen beside two nav buttons.
  const tail =
    start.getUTCMonth() === end.getUTCMonth()
      ? String(end.getUTCDate())
      : `${MONTH_NAMES[end.getUTCMonth()] ?? ''} ${String(end.getUTCDate())}`

  return {
    start: toIso(startMs),
    end: toIso(endMs),
    days: daysBetween(startMs, endMs),
    label: `${MONTH_NAMES[start.getUTCMonth()] ?? ''} ${String(start.getUTCDate())} – ${tail}`,
  }
}

export const windowFor = (unit: WindowUnit, anchor: string, back: number): DateWindow =>
  unit === 'week' ? weekWindow(anchor, back) : monthWindow(anchor, back)

/**
 * How many windows separate the oldest close from the anchor — the furthest
 * back paging may go.
 *
 * Clamping to this is what stops the nav walking off into empty periods that
 * can never hold a trade.
 */
export function windowsBack(unit: WindowUnit, oldest: string, anchor: string): number {
  if (unit === 'week') {
    const span = startOfWeek(toUtc(anchor)) - startOfWeek(toUtc(oldest))
    return Math.max(0, Math.round(span / (7 * DAY_MS)))
  }

  const to = new Date(toUtc(anchor))
  const from = new Date(toUtc(oldest))
  return Math.max(
    0,
    (to.getUTCFullYear() - from.getUTCFullYear()) * 12 + (to.getUTCMonth() - from.getUTCMonth()),
  )
}

export interface DayParts {
  /** Day of month, 1–31. */
  day: number
  /** Three-letter English weekday. */
  weekday: string
  /**
   * Saturday or Sunday. The market is shut, so the column is always empty — it
   * is shaded rather than dropped, because a three-day gap between two trades
   * is real information the reader should see rather than a hole in the axis.
   */
  isWeekend: boolean
}

export function dayParts(iso: string): DayParts {
  const at = new Date(toUtc(iso))
  const weekday = at.getUTCDay()
  return {
    day: at.getUTCDate(),
    weekday: WEEKDAY_NAMES[weekday] ?? '',
    isWeekend: weekday === 0 || weekday === 6,
  }
}

// ── Vertical scale ──────────────────────────────────────────────────────────

/**
 * Breathing room at the top and bottom of the plot, as a percentage of its
 * height.
 *
 * Baked into the geometry rather than added as CSS padding so that gridlines,
 * axis labels and marks are all placed by the same function and cannot drift
 * apart. Without it a circle sitting on the domain's extreme is centred exactly
 * on the plot edge and draws as a half-circle.
 */
export const PLOT_INSET_PCT = 8

export interface ReturnDomain {
  /** Return at the top of the plot, as a fraction — 0.25 is +25%. */
  max: number
  /** Return at the bottom. */
  min: number
  /**
   * Gap between gridlines.
   *
   * Carried on the domain rather than recomputed by `percentTicks`, because the
   * bounds were rounded out to whole multiples of *this* step. Deriving a
   * second step from the already-rounded span gives a different number — 0.25
   * where the bounds were built on 0.2 — and the top gridline then lands short
   * of the top of the plot with a band of dead space above it.
   */
  step: number
  /** Where the zero line sits, as a percentage from the top of the plot. */
  zeroPct: number
}

/** A return's distance from the top of the plot, as a percentage. */
export function yPctFor(value: number, domain: { min: number; max: number }): number {
  const span = domain.max - domain.min
  if (span <= 0) return 50
  const usable = 100 - 2 * PLOT_INSET_PCT
  const raw = PLOT_INSET_PCT + ((domain.max - value) / span) * usable
  // Clamped: a value outside the declared domain (a stale extent, or a caller
  // that forgot a row) must stop at the plot edge rather than draw over the
  // axis labels beside it.
  return Math.min(Math.max(raw, 0), 100)
}

/**
 * The vertical scale, rounded out to whole gridline steps.
 *
 * A side with no data keeps its bound at zero rather than being padded: with no
 * losing trades the zero line belongs at the foot of the plot, not halfway up
 * it wasting half the height on a region nothing can occupy.
 */
export function returnDomain(returns: number[], targetTicks = 4): ReturnDomain {
  const highest = Math.max(0, ...returns)
  const lowest = Math.min(0, ...returns)
  let step = niceStep(highest - lowest, targetTicks)

  let max = step > 0 && highest > 0 ? Math.ceil(highest / step - 1e-9) * step : 0
  let min = step > 0 && lowest < 0 ? Math.floor(lowest / step + 1e-9) * step : 0

  // No closes, or every close broke exactly even. Give the axis a nominal ±5%
  // span so the zero line has somewhere to sit and the plot still reads as one.
  if (max <= min) {
    max = 0.05
    min = -0.05
    step = 0.025
  }

  return { max, min, step, zeroPct: yPctFor(0, { min, max }) }
}

export interface AxisTick {
  /** The return this line marks, as a fraction. */
  value: number
  topPct: number
}

/**
 * Gridline values across the domain, skipping zero — the zero line is drawn
 * separately and stronger, because it is the reference the chart is read
 * against rather than one gradation among several.
 */
export function percentTicks(domain: ReturnDomain): AxisTick[] {
  const { step } = domain
  if (step <= 0) return []

  const ticks: AxisTick[] = []
  // Counted in whole steps rather than accumulated, so a step of 0.025 does not
  // drift into 0.07500000000000001 and print as an eleven-digit axis label.
  const first = Math.ceil(domain.min / step - 1e-9)
  const last = Math.floor(domain.max / step + 1e-9)
  for (let index = first; index <= last; index++) {
    if (index === 0) continue
    const value = index * step
    ticks.push({ value, topPct: yPctFor(value, domain) })
  }
  return ticks
}

// ── Marks ───────────────────────────────────────────────────────────────────

/**
 * Circle radius for a yen magnitude.
 *
 * Radius grows with the *square root* of the amount, because the eye compares
 * circle areas rather than radii: scaling the radius linearly would make a
 * ¥100,000 win look four times a ¥25,000 one instead of four times its area.
 *
 * `minRadius` is a hit-target floor — a ¥200 close still has to be hoverable —
 * so area is proportional above that floor rather than from nothing.
 */
export function bubbleRadius(
  magnitude: number,
  maxMagnitude: number,
  minRadius: number,
  maxRadius: number,
): number {
  if (maxMagnitude <= 0) return minRadius
  const share = Math.min(Math.abs(magnitude) / maxMagnitude, 1)
  return minRadius + (maxRadius - minRadius) * Math.sqrt(share)
}

/** The fraction of one day column that same-day closes are spread across. */
const SAME_DAY_SPREAD = 0.62

export interface ScatterInput {
  /** The day the position was closed, `YYYY-MM-DD`. */
  date: string
  /** Return on the cost basis of the units sold, as a fraction. */
  returnPct: number
  /** Realized yen, signed. Only its magnitude sizes the circle. */
  realizedJpy: number
}

export interface ScatterMark<T> {
  trade: T
  /** Centre of the circle, as a percentage of the plot width. */
  xPct: number
  /** Centre of the circle, as a percentage from the top of the plot. */
  yPct: number
  /** In px — kept in real pixels so the container's aspect cannot distort area. */
  radius: number
}

export interface ScatterOptions {
  /** The window's days, in order. Trades outside them are dropped. */
  days: string[]
  domain: ReturnDomain
  /** Largest |realized| across the *whole dataset*, not this window. */
  maxMagnitude: number
  minRadius: number
  maxRadius: number
}

/**
 * Places every trade, in input order — which becomes DOM order, and so tab
 * order, so callers should pass them chronologically.
 *
 * Closes sharing a day are fanned out horizontally *within their own column*:
 * two closes at the same return on the same day would otherwise draw exactly on
 * top of each other and the one underneath could never be hovered. Same-day
 * round trips are common in this data, so this is not a rare case. The spread
 * is a fraction of one column and never reaches the neighbouring day.
 */
export function scatterGeometry<T extends ScatterInput>(
  trades: T[],
  { days, domain, maxMagnitude, minRadius, maxRadius }: ScatterOptions,
): ScatterMark<T>[] {
  if (days.length === 0) return []

  const columnPct = 100 / days.length
  const dayIndex = new Map(days.map((day, index) => [day, index]))

  const inWindow = trades.filter((trade) => dayIndex.has(trade.date))

  // Counted up front: a trade cannot be placed until its day knows how many
  // closes it holds in total.
  const perDay = new Map<string, number>()
  for (const trade of inWindow) perDay.set(trade.date, (perDay.get(trade.date) ?? 0) + 1)

  const placed = new Map<string, number>()
  return inWindow.map((trade) => {
    const total = perDay.get(trade.date) ?? 1
    const position = placed.get(trade.date) ?? 0
    placed.set(trade.date, position + 1)

    const centre = ((dayIndex.get(trade.date) ?? 0) + 0.5) * columnPct
    const offset = total === 1 ? 0 : (position / (total - 1) - 0.5) * columnPct * SAME_DAY_SPREAD

    return {
      trade,
      xPct: centre + offset,
      yPct: yPctFor(trade.returnPct, domain),
      radius: bubbleRadius(trade.realizedJpy, maxMagnitude, minRadius, maxRadius),
    }
  })
}
