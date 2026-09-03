/**
 * Exchange trading-day calendars.
 *
 * Two of the exit rules are counted in *trading* days, not calendar days: the
 * time stop ("more than 12 trading days without reaching Target 1") and the
 * staleness warning ("no payload for ~3 trading days"). Counting calendar days
 * instead would fire the time stop early on any position spanning Golden Week,
 * and would cry "stale" every Monday morning.
 *
 * The feed itself cannot supply the answer. A missing payload is exactly the
 * ambiguity being resolved — a holiday and a lapsed TradingView alert both look
 * like a gap — so the calendar has to be computed independently of the data.
 *
 * Holidays are derived arithmetically rather than listed, because a hardcoded
 * table silently stops being right the year after it was written and nothing in
 * the app would notice. The formulas below are the statutory rules, so they
 * stay correct as long as the law does.
 *
 * Known limits, both deliberate:
 *  - The equinox approximations hold for 1980–2099. Outside that they drift by
 *    a day; a swing-trading horizon never reaches it.
 *  - One-off Japanese holidays legislated for a single year (the 2019
 *    enthronement, the 2020/2021 Olympic shuffles) are not modelled. They are
 *    all in the past, and an exit rule is only ever evaluated forward from an
 *    open position's entry date.
 */

/** Which exchange's closures apply. Chosen from the instrument's asset class. */
export type MarketCalendar = 'JP' | 'US'

const pad = (n: number): string => String(n).padStart(2, '0')

const iso = (year: number, month: number, day: number): string =>
  `${String(year)}-${pad(month)}-${pad(day)}`

/** Day of week for an ISO date, 0 = Sunday. UTC throughout — no zone shifts. */
const weekdayOf = (date: string): number => new Date(`${date}T00:00:00Z`).getUTCDay()

const addDays = (date: string, delta: number): string =>
  new Date(Date.parse(`${date}T00:00:00Z`) + delta * 86_400_000).toISOString().slice(0, 10)

/** Day-of-month of the `n`th `weekday` (0 = Sunday) in a month. */
const nthWeekday = (year: number, month: number, weekday: number, n: number): number => {
  const firstDow = new Date(Date.UTC(year, month - 1, 1)).getUTCDay()
  return 1 + ((weekday - firstDow + 7) % 7) + (n - 1) * 7
}

/** Day-of-month of the last `weekday` in a month. */
const lastWeekday = (year: number, month: number, weekday: number): number => {
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate()
  const lastDow = new Date(Date.UTC(year, month - 1, lastDay)).getUTCDay()
  return lastDay - ((lastDow - weekday + 7) % 7)
}

// ── Japan ───────────────────────────────────────────────────────────────────

/**
 * 春分の日 / 秋分の日 — astronomical, so the Cabinet Office publishes them a year
 * ahead rather than fixing a date in law. These are the standard approximations
 * (accurate 1980–2099).
 */
const vernalEquinox = (year: number): number =>
  Math.floor(20.8431 + 0.242194 * (year - 1980) - Math.floor((year - 1980) / 4))

const autumnalEquinox = (year: number): number =>
  Math.floor(23.2488 + 0.242194 * (year - 1980) - Math.floor((year - 1980) / 4))

function japanHolidays(year: number): Set<string> {
  const days = new Set<string>([
    iso(year, 1, 1), // 元日
    iso(year, 1, nthWeekday(year, 1, 1, 2)), // 成人の日 — 2nd Monday
    iso(year, 2, 11), // 建国記念の日
    iso(year, 2, 23), // 天皇誕生日 (2020–)
    iso(year, 3, vernalEquinox(year)), // 春分の日
    iso(year, 4, 29), // 昭和の日
    iso(year, 5, 3), // 憲法記念日
    iso(year, 5, 4), // みどりの日
    iso(year, 5, 5), // こどもの日
    iso(year, 7, nthWeekday(year, 7, 1, 3)), // 海の日 — 3rd Monday
    iso(year, 8, 11), // 山の日
    iso(year, 9, nthWeekday(year, 9, 1, 3)), // 敬老の日 — 3rd Monday
    iso(year, 9, autumnalEquinox(year)), // 秋分の日
    iso(year, 10, nthWeekday(year, 10, 1, 2)), // スポーツの日 — 2nd Monday
    iso(year, 11, 3), // 文化の日
    iso(year, 11, 23), // 勤労感謝の日
  ])

  // 振替休日: a holiday falling on a Sunday moves to the next day that is not
  // itself a holiday. Walking forward (rather than taking Monday) is what makes
  // the 3–5 May run behave: when 3 May is a Sunday the substitute lands on the
  // 6th, because the 4th and 5th are already holidays.
  for (const day of [...days].sort()) {
    if (weekdayOf(day) !== 0) continue
    let candidate = addDays(day, 1)
    while (days.has(candidate)) candidate = addDays(candidate, 1)
    days.add(candidate)
  }

  // 国民の休日: an ordinary weekday sandwiched between two holidays becomes one.
  // In practice this is the September "Silver Week" bridge between 敬老の日 and
  // 秋分の日, which occurs whenever they fall exactly two days apart.
  for (const day of [...days]) {
    const gap = addDays(day, 1)
    if (days.has(gap) || weekdayOf(gap) === 0) continue
    if (days.has(addDays(day, 2))) days.add(gap)
  }

  // 年末年始 — 東証 is shut 31 December through 3 January. These are exchange
  // closures, not national holidays, and 2 and 3 January are ordinary working
  // days for everyone else.
  days.add(iso(year, 12, 31))
  days.add(iso(year, 1, 2))
  days.add(iso(year, 1, 3))

  return days
}

// ── United States ───────────────────────────────────────────────────────────

/** Anonymous Gregorian computus — Good Friday is Easter Sunday minus two days. */
function easterSunday(year: number): string {
  const a = year % 19
  const b = Math.floor(year / 100)
  const c = year % 100
  const d = Math.floor(b / 4)
  const e = b % 4
  const f = Math.floor((b + 8) / 25)
  const g = Math.floor((b - f + 1) / 3)
  const h = (19 * a + b - d - g + 15) % 30
  const i = Math.floor(c / 4)
  const k = c % 4
  const l = (32 + 2 * e + 2 * i - h - k) % 7
  const m = Math.floor((a + 11 * h + 22 * l) / 451)
  const month = Math.floor((h + l - 7 * m + 114) / 31)
  const day = ((h + l - 7 * m + 114) % 31) + 1
  return iso(year, month, day)
}

/**
 * NYSE observance rule for the fixed-date holidays: a Saturday holiday is taken
 * on the preceding Friday, a Sunday holiday on the following Monday.
 */
const observed = (date: string): string => {
  const dow = weekdayOf(date)
  if (dow === 6) return addDays(date, -1)
  if (dow === 0) return addDays(date, 1)
  return date
}

function unitedStatesHolidays(year: number): Set<string> {
  const days = new Set<string>([
    observed(iso(year, 1, 1)), // New Year's Day
    iso(year, 1, nthWeekday(year, 1, 1, 3)), // MLK Jr. Day
    iso(year, 2, nthWeekday(year, 2, 1, 3)), // Washington's Birthday
    addDays(easterSunday(year), -2), // Good Friday
    iso(year, 5, lastWeekday(year, 5, 1)), // Memorial Day
    observed(iso(year, 7, 4)), // Independence Day
    iso(year, 9, nthWeekday(year, 9, 1, 1)), // Labor Day
    iso(year, 11, nthWeekday(year, 11, 4, 4)), // Thanksgiving — 4th Thursday
    observed(iso(year, 12, 25)), // Christmas
  ])

  // Juneteenth became a market holiday in 2022; back-dating it would misdate
  // any position opened before then.
  if (year >= 2022) days.add(observed(iso(year, 6, 19)))

  return days
}

// ── Lookup ──────────────────────────────────────────────────────────────────

/**
 * Holiday sets are pure functions of (calendar, year), so they are built once
 * and kept. `tradingDaysBetween` walks day by day and would otherwise rebuild
 * the same year's table on every step.
 */
const cache = new Map<string, Set<string>>()

function holidaysFor(calendar: MarketCalendar, year: number): Set<string> {
  const key = `${calendar}${String(year)}`
  const hit = cache.get(key)
  if (hit) return hit
  const built = calendar === 'JP' ? japanHolidays(year) : unitedStatesHolidays(year)
  cache.set(key, built)
  return built
}

/** True when the exchange is open on this ISO date. */
export function isTradingDay(date: string, calendar: MarketCalendar): boolean {
  const dow = weekdayOf(date)
  if (dow === 0 || dow === 6) return false
  return !holidaysFor(calendar, Number(date.slice(0, 4))).has(date)
}

/** Hard ceiling on the day-by-day walk, so a malformed date cannot spin. */
const MAX_SPAN_DAYS = 20_000

/**
 * Trading days in the half-open range `(from, to]`.
 *
 * Half-open on purpose. "Trading days since entry" must be 0 on the entry date
 * itself and 1 the next session — counting the entry day would put every
 * position a day closer to its time stop than it really is. The same convention
 * makes staleness read naturally: 1 means the feed missed the most recent
 * session. Returns 0 when `to` is on or before `from`.
 */
export function tradingDaysBetween(from: string, to: string, calendar: MarketCalendar): number {
  if (to <= from) return 0

  let count = 0
  let cursor = from
  for (let guard = 0; guard < MAX_SPAN_DAYS; guard++) {
    cursor = addDays(cursor, 1)
    if (cursor > to) break
    if (isTradingDay(cursor, calendar)) count++
  }
  return count
}

/** The calendar an instrument trades on. Funds are never exit-rule eligible. */
export const calendarFor = (assetClass: 'JP_EQUITY' | 'US_EQUITY' | 'FUND'): MarketCalendar =>
  assetClass === 'US_EQUITY' ? 'US' : 'JP'
