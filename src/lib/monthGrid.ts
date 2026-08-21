/**
 * Calendar geometry for a `YYYY-MM` month, derived from the string alone.
 *
 * Every calendar request replays the P&L engine over the whole trade history,
 * so `getCalendar` is slow enough to notice. The month's shape does not depend
 * on any of that, so it is computed on the client and the dated squares are
 * drawn immediately — the figures arrive into a grid that is already there
 * instead of into a blank page.
 *
 * UTC throughout: these are calendar labels, not instants, and building them
 * from local parts would shift a day across a DST boundary. `getCalendar`
 * constructs its `date` keys the same way, so the two line up exactly.
 */
const pad = (n: number): string => String(n).padStart(2, '0')

export interface MonthGrid {
  /** Every day of the month as `YYYY-MM-DD`, in order. */
  dates: string[]
  /** Empty cells before day 1, so it lands under its weekday in a Monday-first grid. */
  leadingBlanks: number
}

/** Parse `YYYY-MM`, falling back to the current month for anything malformed. */
function parse(month: string): { year: number; monthIndex: number } {
  const [y, m] = month.split('-').map(Number)
  const now = new Date()
  return {
    year: y ?? now.getFullYear(),
    monthIndex: (m ?? now.getMonth() + 1) - 1,
  }
}

export function monthGrid(month: string): MonthGrid {
  const { year, monthIndex } = parse(month)

  // Day 0 of the following month is the last day of this one — the only leap
  // year rule that never needs writing down.
  const lastDay = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate()
  const label = `${String(year)}-${pad(monthIndex + 1)}`

  return {
    dates: Array.from({ length: lastDay }, (_, i) => `${label}-${pad(i + 1)}`),
    // getUTCDay() is Sunday-based; this grid is Monday-first, so Sunday maps to 6.
    leadingBlanks: (new Date(Date.UTC(year, monthIndex, 1)).getUTCDay() + 6) % 7,
  }
}

/** The month `delta` months away, as `YYYY-MM`. */
export function shiftMonth(month: string, delta: number): string {
  const { year, monthIndex } = parse(month)
  const shifted = new Date(Date.UTC(year, monthIndex + delta, 1))
  return `${String(shifted.getUTCFullYear())}-${pad(shifted.getUTCMonth() + 1)}`
}
