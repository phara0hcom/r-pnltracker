/**
 * The 再投資 match must see across the account switch.
 *
 * `getDividends` filters both its dividend rows and its trades by the selected
 * account. That is right for every other figure on the screen, but the
 * reinvestment lookup is the one place where the two halves of a single event
 * can legitimately sit in different accounts — so it is given the unfiltered
 * list. Scoping it silently blanked the Reinvested column, which reads as
 * "this distribution was paid in cash" rather than as a missing match.
 */
import { describe, expect, it } from 'vitest'
import { matchesAccountFilter, type AccountFilter } from '../domain/types'
import { loadAllStatements, loadAllTrades } from '../import/loadFixtures'
import { attributeDividends } from './dividends'
import { findReinvestment } from './reinvestment'

const trades = loadAllTrades().trades
const distributions = attributeDividends(loadAllStatements().dividends, trades).filter(
  (payout) => payout.kind === 'DISTRIBUTION',
)

/** Every distribution that pairs with a 再投資 when nothing is filtered out. */
const pairs = distributions
  .map((payout) => ({
    payout,
    reinvest: findReinvestment(trades, payout.symbol, payout.payDate, payout.netAmount.toFixed(0)),
  }))
  .filter((pair) => pair.reinvest !== null)

describe('findReinvestment', () => {
  it('finds the reinvested buy behind a distribution in the real statements', () => {
    expect(pairs.length).toBeGreaterThan(0)
  })

  it('matches on amount, so a different payment is not claimed', () => {
    const { payout } = pairs[0]!
    const wrongAmount = payout.netAmount.add(1).toFixed(0)
    expect(findReinvestment(trades, payout.symbol, payout.payDate, wrongAmount)).toBeNull()
  })

  it('will not reach past the booking window', () => {
    const { payout } = pairs[0]!
    // A month later: same instrument, same amount, far outside the few days
    // Rakuten books the two rows apart.
    const farLater = `${payout.payDate.slice(0, 4)}-${payout.payDate.slice(5, 7)}-01`
    const monthOn = new Date(Date.parse(farLater))
    monthOn.setUTCMonth(monthOn.getUTCMonth() + 2)
    expect(
      findReinvestment(
        trades,
        payout.symbol,
        monthOn.toISOString().slice(0, 10),
        payout.netAmount.toFixed(0),
      ),
    ).toBeNull()
  })
})

describe('surviving the account switch', () => {
  /*
   * The real data contains at least one account-crossing pair: the 2025-12-05
   * netWIN GS distribution is attributed 旧NISA while its 再投資 is booked 特定.
   * That is the case a scoped search loses, so it is asserted to exist — if a
   * future export no longer has one, this test should be revisited rather than
   * quietly passing on a set with nothing left to prove.
   */
  const crossAccount = pairs.filter((pair) => pair.reinvest!.accountType !== pair.payout.accountType)

  it('the real statements contain an account-crossing pair', () => {
    expect(crossAccount.length).toBeGreaterThan(0)
  })

  it.each(['ALL', 'NISA', 'SPECIFIC'] as AccountFilter[])(
    'still pairs every distribution under scope=%s',
    (scope) => {
      for (const { payout, reinvest } of pairs) {
        // Only rows the screen would actually render under this scope.
        if (!matchesAccountFilter(payout.accountType, scope)) continue
        const found = findReinvestment(
          trades,
          payout.symbol,
          payout.payDate,
          payout.netAmount.toFixed(0),
        )
        expect(found?.tradeDate).toBe(reinvest!.tradeDate)
      }
    },
  )

  it('would lose the crossing pair if the trades were scoped — the bug being prevented', () => {
    const { payout, reinvest } = crossAccount[0]!
    // Scope to the payment's own account, which is what the screen filters its
    // rows by. The 再投資 sits in the other one and disappears.
    const scoped = trades.filter((trade) =>
      matchesAccountFilter(trade.accountType, reinvest!.accountType === 'SPECIFIC' ? 'NISA' : 'SPECIFIC'),
    )
    expect(
      findReinvestment(scoped, payout.symbol, payout.payDate, payout.netAmount.toFixed(0)),
    ).toBeNull()
  })
})
