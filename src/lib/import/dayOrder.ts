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
import type Decimal from 'decimal.js'
import { CLOSING_SIDES, OPENING_SIDES, ZERO, type NormalizedTrade } from '../domain/types'
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
 * Units the closes on `date` could not find, per pool.
 *
 * Measured as quantity rather than read from warning text: a clamp warning
 * embeds the quantity held, so two orders that both come up short would never
 * compare equal, and "no open position" is the same text however many closes
 * hit it.
 */
function shortfallOn(trades: NormalizedTrade[], date: string): Map<string, { symbol: string; units: Decimal }> {
  const out = new Map<string, { symbol: string; units: Decimal }>()
  const add = (trade: { symbol: string; accountType: NormalizedTrade['accountType'] }, units: Decimal) => {
    const key = poolKey(trade.symbol, trade.accountType)
    const running = out.get(key) ?? { symbol: trade.symbol, units: ZERO }
    out.set(key, { symbol: trade.symbol, units: running.units.add(units) })
  }
  for (const trade of trades) {
    if (trade.tradeDate === date && CLOSING_SIDES.includes(trade.side)) add(trade, trade.quantity)
  }
  for (const close of runEngine(trades).realized) {
    if (close.tradeDate === date) add(close, close.quantity.neg())
  }
  return out
}

/**
 * Why a proposed order of `date` is refused, or null when it is fine.
 *
 * `sequence` maps row ids to their proposed place. A shortfall the history
 * already has is not held against the order — only one it makes larger,
 * which means it sells units the pool does not yet hold.
 */
export function orderProblem(
  records: readonly { id: string; trade: NormalizedTrade }[],
  date: string,
  sequence: ReadonlyMap<string, number>,
): string | null {
  const before = shortfallOn(
    records.map((record) => record.trade),
    date,
  )
  const after = shortfallOn(
    records.map((record) => {
      const position = sequence.get(record.id)
      return position == null ? record.trade : { ...record.trade, daySequence: position }
    }),
    date,
  )
  for (const [key, { symbol, units }] of after) {
    if (units.gt(before.get(key)?.units ?? ZERO)) {
      return `That order sells ${symbol} before enough of it was bought.`
    }
  }
  return null
}
