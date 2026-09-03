/**
 * Where the current holding streak began.
 *
 * The exit framework needs the date and price of *this* swing entry, which is
 * not what the P&L engine tracks. The engine keeps a 移動平均法 pool: a running
 * weighted average that has no notion of "the trade that opened this position",
 * because under moving-average cost basis units are fungible and no individual
 * buy survives as a distinct lot.
 *
 * So this walks the pool's trades and finds the point where quantity last went
 * from flat to long. That is the entry the swing was actually put on at, and it
 * is only ever used to *prefill* the form — the value is then locked into the
 * exit rule, where a later top-up cannot shift it.
 */
import Decimal from 'decimal.js'
import { CLOSING_SIDES, OPENING_SIDES, type AccountType, type NormalizedTrade } from '../domain/types'
import { sortTradesForEngine } from '../pnl/engine'

export interface EntryStreak {
  symbol: string
  accountType: AccountType
  /** Trade date of the buy that reopened the position. */
  entryDate: string
  /**
   * Weighted-average price of the buys in this streak, native currency.
   *
   * Averaged over the streak rather than taken from the first buy alone: a
   * position scaled into over three days was entered at the blend, and the risk
   * unit R has to be measured from the price actually paid.
   */
  entryPrice: Decimal
  /** Units bought during the streak, before any partial exit. */
  totalShares: Decimal
}

const key = (symbol: string, account: AccountType) => `${symbol}\0${account}`

/**
 * The open streak for every pool that currently holds units, keyed
 * `symbol\0accountType`. Closed pools are absent.
 */
export function openEntryStreaks(trades: NormalizedTrade[]): Map<string, EntryStreak> {
  const pools = new Map<string, NormalizedTrade[]>()
  // Engine ordering, so a same-day round trip cannot look like it closed before
  // it opened — which would strand the streak on the wrong side of the flat.
  for (const trade of sortTradesForEngine(trades)) {
    const poolKey = key(trade.symbol, trade.accountType)
    pools.set(poolKey, [...(pools.get(poolKey) ?? []), trade])
  }

  const out = new Map<string, EntryStreak>()

  for (const [poolKey, list] of pools) {
    let quantity = new Decimal(0)
    let streak: EntryStreak | null = null

    for (const trade of list) {
      if (OPENING_SIDES.includes(trade.side)) {
        if (quantity.lte(0)) {
          // Flat, so this buy starts a new streak. Anything recorded for a
          // previous streak is discarded — only the live one matters.
          streak = {
            symbol: trade.symbol,
            accountType: trade.accountType,
            entryDate: trade.tradeDate,
            entryPrice: trade.unitPrice,
            totalShares: trade.quantity,
          }
        } else if (streak !== null) {
          // Bound before the assignment: reading `streak` inside the object that
          // replaces it makes its own type circular.
          const open: EntryStreak = streak
          const combined = open.totalShares.add(trade.quantity)
          streak = {
            ...open,
            entryPrice: combined.gt(0)
              ? open.entryPrice
                  .mul(open.totalShares)
                  .add(trade.unitPrice.mul(trade.quantity))
                  .div(combined)
              : open.entryPrice,
            totalShares: combined,
          }
        }
        quantity = quantity.add(trade.quantity)
        continue
      }

      if (CLOSING_SIDES.includes(trade.side)) {
        quantity = quantity.sub(trade.quantity)
        // Fully closed — the next buy will start a fresh streak. A partial sell
        // deliberately does not reset it: that is the Target 1 exit, and the
        // remaining shares are still the same swing.
        if (quantity.lte(0)) streak = null
      }
    }

    if (streak && quantity.gt(0)) out.set(poolKey, streak)
  }

  return out
}

/** Lookup helper, so callers do not have to know the key encoding. */
export const streakFor = (
  streaks: Map<string, EntryStreak>,
  symbol: string,
  account: AccountType,
): EntryStreak | null => streaks.get(key(symbol, account)) ?? null
