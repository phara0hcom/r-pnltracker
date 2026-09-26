/**
 * Journal edits applied to a cached month, for optimistic updates.
 *
 * Each of these replaces exactly one field and copies the rest through, so an
 * edit and its rollback are the same operation with different values. That
 * symmetry is the point: rolling a failed save back by restoring a snapshot of
 * the whole month instead would also discard any *other* edit applied while the
 * request was in flight — a day dialog holds one of these mutations per trade,
 * and they overlap freely.
 */
import type { CalendarDay, CalendarMonth } from '~/server/screens'

/** Replace one day's journal entry. `null` clears it. */
export function withNote(
  month: CalendarMonth | undefined,
  date: string,
  note: CalendarDay['note'],
): CalendarMonth | undefined {
  return month && { ...month, days: month.days.map((day) => (day.date === date ? { ...day, note } : day)) }
}

/**
 * Replace one trade's journal fields wherever that trade appears.
 *
 * Scans every day because the caller patches each cached month blind — a row
 * inside the open dialog does not know which month query it was drawn from.
 */
export function withTradeJournal(
  month: CalendarMonth | undefined,
  tradeId: string,
  journal: { memo: string | null; motivation: number | null },
): CalendarMonth | undefined {
  return (
    month && {
      ...month,
      days: month.days.map((day) => ({
        ...day,
        trades: day.trades.map((trade) =>
          trade.id === tradeId ? { ...trade, ...journal } : trade,
        ),
      })),
    }
  )
}
