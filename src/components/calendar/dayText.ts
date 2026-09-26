/**
 * How the Calendar words a day: its date, its figures and its label for a
 * screen reader. Display only — every figure arrives computed.
 *
 * Dates are `YYYY-MM-DD` labels, read in UTC like `monthGrid` builds them, so
 * no timezone can move a day onto its neighbour's weekday.
 */
import { MOOD_LABELS } from './MoodFace'
import { dollarsCompact, moneySigned, yenCompact, yenSigned } from '~/components/format'
import type { MarketSplitView } from '~/lib/pnl/markets'
import type { CalendarDay } from '~/server/screens'

export const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

const parts = (date: string) => {
  const [year = 0, month = 1, day = 1] = date.split('-').map(Number)
  return { year, month, day }
}

/** `September 2026`, from `2026-09`. */
export function monthLabel(month: string): string {
  const { year, month: index } = parts(`${month}-01`)
  return `${MONTH_NAMES[index - 1] ?? ''} ${String(year)}`
}

/** `Thu`, Monday-first like the grid. */
export function weekdayOf(date: string): string {
  const { year, month, day } = parts(date)
  return WEEKDAYS[(new Date(Date.UTC(year, month - 1, day)).getUTCDay() + 6) % 7] ?? ''
}

/** `10 Sep`. */
export function dayMonth(date: string): string {
  const { month, day } = parts(date)
  return `${String(day)} ${(MONTH_NAMES[month - 1] ?? '').slice(0, 3)}`
}

/** `Thu 10 Sep`. */
export const weekdayDayMonth = (date: string): string => `${weekdayOf(date)} ${dayMonth(date)}`

/** `Thursday 10 September 2026`, for a dialog's heading. */
export function longDate(date: string): string {
  const { year, month, day } = parts(date)
  const weekday = new Date(Date.UTC(year, month - 1, day)).toLocaleDateString('en-GB', {
    weekday: 'long',
    timeZone: 'UTC',
  })
  return `${weekday} ${String(day)} ${MONTH_NAMES[month - 1] ?? ''} ${String(year)}`
}

/** `1–6 Sep`, or `30 Sep` for a one-day week. */
export function rangeLabel(from: string, to: string): string {
  return from === to ? dayMonth(from) : `${String(parts(from).day)}–${dayMonth(to)}`
}

export interface DayFigure {
  key: 'jpy' | 'usd'
  /** The signed amount, in the side's own currency — for its tint. */
  value: string
  /** In full, where there is room. */
  full: string
  /** Shortened for a narrow cell. */
  short: string
}

/**
 * A day's figures the way Rakuten's app gives them: the JPY account in yen,
 * the USD account in dollars. Sides with no close are left out.
 */
export function dayFigures(markets: MarketSplitView | null): DayFigure[] {
  if (!markets) return []
  const out: DayFigure[] = []
  if (markets.jpyRealizedJpy != null) {
    out.push({
      key: 'jpy',
      value: markets.jpyRealizedJpy,
      full: yenSigned(markets.jpyRealizedJpy),
      short: yenCompact(markets.jpyRealizedJpy),
    })
  }
  if (markets.usdRealizedUsd != null) {
    out.push({
      key: 'usd',
      value: markets.usdRealizedUsd,
      full: moneySigned(markets.usdRealizedUsd, 'USD'),
      short: dollarsCompact(markets.usdRealizedUsd),
    })
  }
  return out
}

/** `3 trades`, `2 trades · no closes`. */
export function tradesLabel(day: Pick<CalendarDay, 'tradeCount' | 'realizedJpy'>): string {
  if (day.tradeCount === 0) return ''
  const count = `${String(day.tradeCount)} trade${day.tradeCount === 1 ? '' : 's'}`
  return day.realizedJpy == null ? `${count} · no closes` : count
}

/** The whole day in words, for the cell a screen reader lands on. */
export function dayAriaLabel(day: CalendarDay, isToday: boolean): string {
  const split = day.markets
  const realized = split
    ? [
        split.jpyRealizedJpy == null ? null : `JPY account ${yenSigned(split.jpyRealizedJpy)}`,
        split.usdRealizedUsd == null
          ? null
          : `USD account ${moneySigned(split.usdRealizedUsd, 'USD')}, ${yenSigned(split.usdRealizedJpy)} in yen`,
      ]
        .filter((part) => part != null)
        .join(' and ')
    : null
  const mood = day.note?.mood ? MOOD_LABELS[day.note.mood] : null
  return [
    weekdayDayMonth(day.date),
    isToday ? 'today' : null,
    realized ? `realized ${realized}` : null,
    day.tradeCount > 0 ? tradesLabel(day) : 'no trades',
    day.note ? `journal entry${mood ? `, mood ${mood.toLowerCase()}` : ''}` : null,
  ]
    .filter((part) => part != null)
    .join(', ')
}
