/**
 * Which days an import leaves in an order worth checking, and in what order.
 *
 * Rakuten exports carry no execution time. On a day where one pool is both
 * bought and sold, the engine's opens-first default can differ from what
 * happened — buy 29, sell 20, buy 2, sell 11 is averaged as if all 31 shares
 * were bought first — and only the user knows the real order. The import
 * preview shows these days so it can be set before anything is written.
 *
 * Pure: the caller supplies the stored trades and the ids the new rows will
 * have, so this stays DB-free like the rest of `lib`.
 */
import { OPENING_SIDES, type NormalizedTrade } from '../domain/types'
import { poolKey, runEngine, sortTradesForEngine } from '../pnl/engine'

export interface OrderCandidate {
  /** The row id — stored, or the one the import will insert under. */
  id: string
  trade: NormalizedTrade
  /** True when the pending import adds or re-dates this row. */
  incoming: boolean
}

export interface DayToOrder {
  date: string
  /** In the order the engine would take them if nothing is changed. */
  trades: OrderCandidate[]
}

/**
 * The days `incoming` lands on where a pool has both an open and a close,
 * each with just that pool's trades.
 *
 * An incoming row whose id is already stored is a restatement: it replaces
 * the stored copy, on its new date.
 */
export function daysToOrder(
  stored: readonly OrderCandidate[],
  incoming: readonly OrderCandidate[],
): DayToOrder[] {
  const replaced = new Set(incoming.map((candidate) => candidate.id))
  const all = [...stored.filter((candidate) => !replaced.has(candidate.id)), ...incoming]
  const dates = new Set(incoming.map((candidate) => candidate.trade.tradeDate))

  const days: DayToOrder[] = []
  for (const date of [...dates].sort()) {
    const onDay = all.filter((candidate) => candidate.trade.tradeDate === date)

    // Order only matters inside a pool that is both opened and closed that day.
    const sides = new Map<string, { opens: boolean; closes: boolean }>()
    for (const { trade } of onDay) {
      const key = poolKey(trade.symbol, trade.accountType)
      const seen = sides.get(key) ?? { opens: false, closes: false }
      if (OPENING_SIDES.includes(trade.side)) seen.opens = true
      else seen.closes = true
      sides.set(key, seen)
    }
    const mixed = onDay.filter(({ trade }) => {
      const seen = sides.get(poolKey(trade.symbol, trade.accountType))
      return seen?.opens === true && seen.closes
    })
    if (mixed.length === 0) continue

    const byTrade = new Map(mixed.map((candidate) => [candidate.trade, candidate]))
    days.push({
      date,
      trades: sortTradesForEngine(mixed.map((candidate) => candidate.trade)).map(
        (trade) => byTrade.get(trade)!,
      ),
    })
  }
  return days
}

/**
 * The first engine warning a proposed order adds on `date`, or null.
 *
 * `sequence` maps row ids to their proposed place. Warnings the history
 * already has are not held against the order — only new ones, which mean it
 * sells units the pool does not yet hold.
 */
export function orderProblem(
  records: readonly { id: string; trade: NormalizedTrade }[],
  date: string,
  sequence: ReadonlyMap<string, number>,
): string | null {
  const onDate = (list: NormalizedTrade[]) =>
    runEngine(list)
      .warnings.filter((warning) => warning.tradeDate === date)
      .map((warning) => ({
        symbol: warning.symbol,
        key: `${warning.symbol}|${warning.accountType}|${warning.message}`,
      }))

  const before = new Set(onDate(records.map((record) => record.trade)).map((warning) => warning.key))
  const added = onDate(
    records.map((record) => {
      const position = sequence.get(record.id)
      return position == null ? record.trade : { ...record.trade, daySequence: position }
    }),
  ).find((warning) => !before.has(warning.key))

  return added ? `That order sells ${added.symbol} before enough of it was bought.` : null
}
