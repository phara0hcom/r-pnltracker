/**
 * "Today" in the user's own timezone.
 *
 * `new Date().toISOString()` converts to UTC first, so for JST (UTC+9) it
 * returns the *previous* calendar day until 09:00 local — the window when this
 * app is most likely to be opened before the JP market. A trade dated a day
 * early lands in the wrong tax year at a year boundary and the wrong NISA
 * annual frame, so every default date has to be built from local parts.
 */
const pad = (n: number): string => String(n).padStart(2, '0')

/** Local calendar date as `YYYY-MM-DD`. */
export const todayLocal = (now: Date = new Date()): string =>
  `${String(now.getFullYear())}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`

/** Local calendar month as `YYYY-MM`. */
export const thisMonthLocal = (now: Date = new Date()): string =>
  `${String(now.getFullYear())}-${pad(now.getMonth() + 1)}`
