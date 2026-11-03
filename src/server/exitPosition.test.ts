/**
 * Which holding a plan is evaluated against. Pure despite the directory: only
 * `import type` reaches the database module.
 */
import Decimal from 'decimal.js'
import { describe, expect, it } from 'vitest'
import { filedHoldings, holdingContext, holdingFacts } from './exitPosition'
import type { ExitRuleRecord } from '~/db/exit.service'
import { holdingStreaks } from '~/lib/playbook/streaks'
import { makeTrade } from '~/test/trade'

const rule = (over: Partial<ExitRuleRecord> = {}): ExitRuleRecord => ({
  id: 'plan',
  userId: 'u',
  instrumentId: 'i',
  symbol: '8411',
  name: '8411',
  assetClass: 'JP_EQUITY',
  accountType: 'SPECIFIC',
  entryDate: '2026-09-01',
  entryPrice: new Decimal(100),
  totalShares: new Decimal(10),
  supportLevel: new Decimal(90),
  entryAtr: null,
  entryStopAtrMultiple: new Decimal(2),
  entryTargetMultiple: new Decimal(2),
  target1Override: null,
  journalId: null,
  lotSize: 100,
  trailingMethod: null,
  note: null,
  archivedAt: null,
  ...over,
})

const entry = (over = {}) => ({
  id: 'j1',
  kind: 'REAL' as const,
  symbol: '8411',
  assetClass: 'JP_EQUITY' as const,
  accountType: 'SPECIFIC' as const,
  entryDate: '2026-09-01',
  anchorTradeId: null as string | null,
  legs: [] as { side: 'ENTRY' | 'EXIT'; firstTradeId: string | null; quantity: Decimal | null }[],
  ...over,
})

const context = (trades: ReturnType<typeof makeTrade>[], entries: ReturnType<typeof entry>[]) => {
  const streaks = holdingStreaks(trades.map((trade, index) => ({ id: `t${String(index + 1)}`, trade })))
  return holdingContext(
    streaks.filter((streak) => streak.closeDate === null).map((streak) => ({
      symbol: streak.symbol,
      accountType: streak.accountType,
      quantity: streak.sharesHeld,
    })),
    trades,
    entries,
    streaks,
  )
}

describe('holdingFacts', () => {
  it('reads a position awaiting import from its typed legs, so it does not read closed', () => {
    const typed = [{ side: 'ENTRY' as const, firstTradeId: null, quantity: new Decimal(100) }]
    const facts = holdingFacts(rule({ journalId: 'j1' }), context([], [entry({ legs: typed })]))
    expect(facts.sharesRemaining.toFixed()).toBe('100')
    expect(facts.sharesSold.toFixed()).toBe('0')
  })

  it('reads a linked position from its own streak, not whatever the pool holds now', () => {
    const trades = [
      makeTrade({ side: 'BUY' }),
      makeTrade({ side: 'SELL', tradeDate: '2026-09-05' }),
      makeTrade({ side: 'BUY', tradeDate: '2026-09-10', quantity: new Decimal(70) }),
    ]
    const facts = holdingFacts(rule({ journalId: 'j1' }), context(trades, [entry({ anchorTradeId: 't1' })]))
    expect(facts.sharesRemaining.toFixed()).toBe('0')
    expect(facts.sharesSold.toFixed()).toBe('10')
  })

  it('reads the pool as it always has for a plan with no position', () => {
    const facts = holdingFacts(rule(), context([makeTrade({ side: 'BUY', quantity: new Decimal(30) })], []))
    expect(facts.sharesRemaining.toFixed()).toBe('30')
    expect(facts.currentStreakEntryDate).toBe('2026-09-01')
  })

  it('falls back to the pool when the position lost its trades', () => {
    const trades = [makeTrade({ side: 'BUY', tradeDate: '2026-10-01', quantity: new Decimal(30) })]
    const facts = holdingFacts(rule({ journalId: 'j1' }), context(trades, [entry({ anchorTradeId: 'gone' })]))
    expect(facts.sharesRemaining.toFixed()).toBe('30')
  })
})

describe('filedHoldings', () => {
  it('leaves paper positions out: they never have a plan to evaluate', () => {
    expect(filedHoldings([entry({ kind: 'PAPER', accountType: null })], []).size).toBe(0)
  })
})
