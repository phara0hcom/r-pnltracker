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
import type { CalendarDay } from '~/server/screens'

/** Replace one day's journal entry. `null` clears it. */
export function withNote(
  days: CalendarDay[] | undefined,
  date: string,
  note: CalendarDay['note'],
): CalendarDay[] | undefined {
  return days?.map((day) => (day.date === date ? { ...day, note } : day))
}

/**
 * Replace one trade's journal fields wherever that trade appears.
 *
 * Scans every day because the caller patches each cached month blind — a row
 * inside the open dialog does not know which month query it was drawn from.
 */
export function withTradeJournal(
  days: CalendarDay[] | undefined,
  tradeId: string,
  journal: { memo: string | null; motivation: number | null },
): CalendarDay[] | undefined {
  return days?.map((day) => ({
    ...day,
    trades: day.trades.map((trade) =>
      trade.id === tradeId ? { ...trade, ...journal } : trade,
    ),
  }))
}
