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
import type Decimal from 'decimal.js'
import type { AccountType, NormalizedTrade } from '../domain/types'
import { holdingStreaks, isOpen } from '../playbook/streaks'
import { poolKey } from '../pnl/engine'

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
  /**
   * Units sold during the streak.
   *
   * Carried so the exit framework can tell "the Target 1 partial has been taken"
   * from an actual realized sell rather than from `remaining < totalShares`,
   * which a later top-up silently falsifies.
   */
  sharesSold: Decimal
  /**
   * Trade date of the sell that last left the pool flat before this streak
   * began, or null when it never has been.
   *
   * This, not `entryDate`, is what says a plan has been outlived. A US fill is
   * re-dated a day later once it settles, so a streak's start can move past the
   * date its plan was made against with nothing having been sold.
   */
  priorCloseDate: string | null
}

/**
 * The open streak for every pool that currently holds units, keyed
 * `symbol\0accountType`. Closed pools are absent.
 *
 * Read off `holdingStreaks`, so "flat" has one definition across the exit
 * framework and the Playbook.
 */
export function openEntryStreaks(trades: NormalizedTrade[]): Map<string, EntryStreak> {
  const out = new Map<string, EntryStreak>()
  // Ids are irrelevant here; only the streaks' figures are read.
  for (const streak of holdingStreaks(trades.map((trade, index) => ({ id: String(index), trade })))) {
    if (!isOpen(streak)) continue
    out.set(poolKey(streak.symbol, streak.accountType), {
      symbol: streak.symbol,
      accountType: streak.accountType,
      entryDate: streak.entryDate,
      entryPrice: streak.entryPrice,
      totalShares: streak.sharesBought,
      sharesSold: streak.sharesSold,
      priorCloseDate: streak.priorCloseDate,
    })
  }
  return out
}

/** Lookup helper, so callers do not have to know the key encoding. */
export const streakFor = (
  streaks: Map<string, EntryStreak>,
  symbol: string,
  account: AccountType,
): EntryStreak | null => streaks.get(poolKey(symbol, account)) ?? null
