/**
 * Pairing a 再投資 buy with the distribution that funded it.
 *
 * Rakuten books the two in different files — the payment in the 取引残高報告書,
 * the reinvested buy in the trade history — with no id linking them in any
 * export. The match is therefore on instrument + exact amount within a short
 * window, which is safe because a fund pays a given amount on a given day once.
 *
 * Lives here rather than inline in the screen so it can be tested against the
 * real statements: the account-crossing case below is not something synthetic
 * data would ever produce.
 */
import type { NormalizedTrade } from '../domain/types'

/**
 * Rakuten books the 再投資 a few days *before* the payment date, so the window
 * is deliberately two-sided rather than forward-looking.
 */
export const REINVEST_MATCH_WINDOW_MS = 7 * 86_400_000

/**
 * Find the 再投資 buy that a distribution was rolled into, or null.
 *
 * `trades` must be **every** trade, not a filtered view. Rakuten does not
 * always file the reinvested buy under the account the payment was attributed
 * to, so an account-scoped list drops one half of a legitimate pair and the
 * screen then reports the distribution as never reinvested. See the test.
 */
export function findReinvestment(
  trades: NormalizedTrade[],
  symbol: string,
  payDate: string,
  netAmount: string,
): NormalizedTrade | null {
  return (
    trades.find(
      (trade) =>
        trade.side === 'REINVEST' &&
        trade.symbol === symbol &&
        trade.netAmountJpy.toFixed(0) === netAmount &&
        Math.abs(Date.parse(trade.tradeDate) - Date.parse(payDate)) <=
          REINVEST_MATCH_WINDOW_MS,
    ) ?? null
  )
}
