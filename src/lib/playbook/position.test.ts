/**
 * A position as the screens read it: status, result, R, score, and which note a
 * trade shows. Every figure is derived, so these go through `derivePosition` with
 * real streaks and the engine's own closes rather than hand-built results.
 */
import Decimal from 'decimal.js'
import { describe, expect, it } from 'vitest'
import type { NormalizedTrade } from '../domain/types'
import { runEngine } from '../pnl/engine'
import { derivePosition, legNote, sharedNotes, type PlanBasis, type StoredLeg, type StoredPosition } from './position'
import { holdingStreaks, streakOfPlan, type StreakTrade } from './streaks'
import { makeTrade } from '~/test/trade'

const position = (over: Partial<StoredPosition> = {}): StoredPosition => ({
  id: 'p1',
  kind: 'REAL',
  symbol: '8411',
  assetClass: 'JP_EQUITY',
  accountType: 'SPECIFIC',
  entryDate: '2026-09-01',
  anchorTradeId: 't1',
  archivedAt: null,
  stopPrice: null,
  target1Price: null,
  accountEquity: null,
  riskRatingOverride: null,
  legs: [],
  ...over,
})

const annotation = (over: Partial<StoredLeg>): StoredLeg => ({
  id: 'a1',
  side: 'ENTRY',
  date: '2026-09-01',
  firstTradeId: 't1',
  executedAt: null,
  price: null,
  quantity: null,
  fee: null,
  rating: null,
  note: null,
  ...over,
})

const typed = (over: Partial<StoredLeg>): StoredLeg =>
  annotation({ firstTradeId: null, price: new Decimal(100), quantity: new Decimal(10), fee: new Decimal(0), ...over })

const plan: PlanBasis = {
  entryPrice: new Decimal(100),
  stop: new Decimal(90),
  target1: new Decimal(120),
  shares: new Decimal(10),
}

function book(trades: NormalizedTrade[], memos: Record<string, string> = {}) {
  const records: StreakTrade[] = trades.map((trade, index) => ({
    id: `t${String(index + 1)}`,
    trade,
    memo: memos[`t${String(index + 1)}`] ?? null,
  }))
  const engine = runEngine(trades)
  return {
    streaks: holdingStreaks(records),
    realizedBy: new Map(engine.realized.map((close) => [close.trade, close])),
    engine,
  }
}

const buy = (over: Partial<NormalizedTrade> = {}) => makeTrade({ side: 'BUY', ...over })
const sell = (over: Partial<NormalizedTrade> = {}) =>
  makeTrade({ side: 'SELL', tradeDate: '2026-09-10', unitPrice: new Decimal(120), ...over })

describe('status', () => {
  it('reads Awaiting import with no anchor, Open while held and Closed when flat', () => {
    const open = book([buy()])
    expect(derivePosition(position({ anchorTradeId: null }), open.streaks, open.realizedBy, null).status).toBe(
      'AWAITING_IMPORT',
    )
    expect(derivePosition(position(), open.streaks, open.realizedBy, null).status).toBe('OPEN')
    const closed = book([buy(), sell()])
    expect(derivePosition(position(), closed.streaks, closed.realizedBy, null).status).toBe('CLOSED')
  })

  it('says it cannot find its trades rather than guessing, and lists its notes as unattached', () => {
    const none = book([buy({ tradeDate: '2026-10-01' })])
    const derived = derivePosition(
      position({ anchorTradeId: 'gone', legs: [annotation({ firstTradeId: null, note: 'kept' })] }),
      none.streaks,
      none.realizedBy,
      null,
    )
    expect(derived.status).toBe('MISSING')
    expect(derived.legs).toEqual([])
    expect(derived.unattached.map((leg) => leg.note)).toEqual(['kept'])
  })

  it('a paper position reads its status from its typed legs and never needs a trade', () => {
    const empty = book([])
    const held = position({ kind: 'PAPER', accountType: null, anchorTradeId: null, legs: [typed({ id: 'l1' })] })
    expect(derivePosition(held, empty.streaks, empty.realizedBy, null).status).toBe('OPEN')
    const closed = {
      ...held,
      legs: [typed({ id: 'l1' }), typed({ id: 'l2', side: 'EXIT', date: '2026-09-05', price: new Decimal(110) })],
    }
    const derived = derivePosition(closed, empty.streaks, empty.realizedBy, null)
    expect(derived.status).toBe('CLOSED')
    expect(derived.result?.shown.toFixed()).toBe('100')
    expect(derived.result?.jpy).toBeNull()
    expect(derived.closeDate).toBe('2026-09-05')
  })
})

describe('result and R', () => {
  it('takes a JP result from the engine, and R over the units closed', () => {
    const { streaks, realizedBy, engine } = book([buy(), sell()])
    const derived = derivePosition(position(), streaks, realizedBy, plan)
    expect(derived.result?.shown.eq(engine.realized[0]!.realizedJpy)).toBe(true)
    // (120 − 100) × 10 over (100 − 90) × 10.
    expect(derived.r?.toFixed(2)).toBe('2.00')
    expect(derived.plannedR?.toFixed(2)).toBe('2.00')
  })

  it('shows a US close in dollars as Rakuten does, and takes R from the figure net of both commissions', () => {
    const fxRate = new Decimal(150)
    const us = { symbol: 'AAPL', assetClass: 'US_EQUITY', currency: 'USD', fxRate, fee: new Decimal(5) } as const
    const { streaks, realizedBy, engine } = book([
      buy({ ...us, netAmount: new Decimal(1005), netAmountJpy: new Decimal(150750) }),
      sell({ ...us, netAmount: new Decimal(1195), netAmountJpy: new Decimal(179250) }),
    ])
    const close = engine.realized[0]!
    const derived = derivePosition(position({ symbol: 'AAPL', assetClass: 'US_EQUITY' }), streaks, realizedBy, plan)

    // The sale less the cost of the shares with the buy commission in it; the
    // sell commission not taken off.
    expect(derived.result?.shown.toFixed(2)).toBe(new Decimal(1200).sub(close.costNative).toFixed(2))
    expect(derived.result?.jpy?.eq(close.realizedJpy)).toBe(true)
    expect(derived.result?.native.eq(close.realizedNative)).toBe(true)
    expect(derived.result?.native.lt(derived.result.shown)).toBe(true)
    expect(derived.r?.eq(close.realizedNative.div(100))).toBe(true)
  })

  it('takes R from a static stop when there is no plan, and has none without a stop', () => {
    const { streaks, realizedBy } = book([buy(), sell()])
    expect(
      derivePosition(position({ stopPrice: new Decimal(95) }), streaks, realizedBy, null).r?.toFixed(2),
    ).toBe('4.00')
    expect(derivePosition(position(), streaks, realizedBy, null).r).toBeNull()
  })

  it('counts only this streak, not an earlier swing of the same pool', () => {
    const { streaks, realizedBy } = book([
      buy({ tradeDate: '2026-08-01' }),
      sell({ tradeDate: '2026-08-05', unitPrice: new Decimal(50) }),
      buy({ tradeDate: '2026-09-01' }),
      sell(),
    ])
    const derived = derivePosition(position({ anchorTradeId: 't3' }), streaks, realizedBy, plan)
    expect(derived.result?.unitsClosed.toFixed()).toBe('10')
    expect(derived.result?.shown.gt(0)).toBe(true)
  })
})

describe('score', () => {
  it('rates risk from the plan as sized, so a later top-up does not rescore it', () => {
    const before = book([buy()])
    const after = book([buy(), buy({ tradeDate: '2026-09-05' })])
    const stored = position({ accountEquity: new Decimal(100_000) })
    expect(derivePosition(stored, after.streaks, after.realizedBy, plan).score.risk).toBe(
      derivePosition(stored, before.streaks, before.realizedBy, plan).score.risk,
    )
  })

  it('stays provisional until it is closed and every part and leg is in', () => {
    const { streaks, realizedBy } = book([buy(), sell()])
    const full = position({
      accountEquity: new Decimal(100_000),
      legs: [
        annotation({ id: 'a1', rating: 8 }),
        annotation({ id: 'a2', side: 'EXIT', date: '2026-09-10', firstTradeId: 't2', rating: 6 }),
      ],
    })
    expect(derivePosition(full, streaks, realizedBy, plan).score.provisional).toBe(false)
    const unrated = { ...full, legs: [annotation({ id: 'a1', rating: 8 })] }
    expect(derivePosition(unrated, streaks, realizedBy, plan).score.provisional).toBe(true)
    const open = book([buy()])
    expect(derivePosition(full, open.streaks, open.realizedBy, plan).score.provisional).toBe(true)
  })
})

describe('the shared note', () => {
  it('reads the fills’ memos until the owner writes one, joined when they differ', () => {
    expect(legNote(null, [{ memo: 'a' }, { memo: 'a' }])).toEqual({ note: 'a', fromMemos: true })
    expect(legNote(null, [{ memo: 'a' }, { memo: 'b' }, { memo: null }])).toEqual({ note: 'a · b', fromMemos: true })
    expect(legNote(null, [{ memo: null }])).toEqual({ note: '', fromMemos: false })
    expect(legNote('mine', [{ memo: 'a' }])).toEqual({ note: 'mine', fromMemos: false })
  })

  it('an emptied note stays empty instead of bringing the memos back', () => {
    expect(legNote('', [{ memo: 'a' }])).toEqual({ note: '', fromMemos: false })
  })

  it('gives every fill of a leg the same note, and leaves trades outside a position alone', () => {
    const { streaks } = book(
      [buy(), buy(), sell(), buy({ symbol: '7203', tradeDate: '2026-09-02' })],
      { t1: 'first fill', t2: 'second fill' },
    )
    const notes = sharedNotes([position({ legs: [annotation({ note: 'the why' })] })], streaks)
    expect(notes.get('t1')?.note).toBe('the why')
    expect(notes.get('t2')?.note).toBe('the why')
    expect(notes.get('t2')?.firstTradeId).toBe('t1')
    expect(notes.get('t3')?.note).toBe('')
    expect(notes.has('t4')).toBe(false)
  })

  it('gives the memos back once the position is archived', () => {
    const { streaks } = book([buy()])
    expect(sharedNotes([position({ archivedAt: new Date() })], streaks).size).toBe(0)
  })

  it('never claims a paper position’s nonexistent trades', () => {
    const { streaks } = book([buy()])
    expect(sharedNotes([position({ kind: 'PAPER', accountType: null })], streaks).size).toBe(0)
  })
})

describe('streakOfPlan', () => {
  const plan8411 = { symbol: '8411', accountType: 'SPECIFIC', assetClass: 'JP_EQUITY', entryDate: '2026-09-01' } as const

  it('finds the streak starting on the plan’s date, or running across it', () => {
    const { streaks } = book([buy(), sell()])
    expect(streakOfPlan(plan8411, streaks)?.anchorId).toBe('t1')
    expect(streakOfPlan({ ...plan8411, entryDate: '2026-09-05' }, streaks)?.anchorId).toBe('t1')
  })

  it('finds nothing when the pool held nothing then', () => {
    const { streaks } = book([buy(), sell()])
    expect(streakOfPlan({ ...plan8411, entryDate: '2026-10-01' }, streaks)).toBeNull()
  })

  it('accepts the day after for a US pool, which Rakuten re-dates, and not for a JP one', () => {
    const us = { symbol: 'AAPL', assetClass: 'US_EQUITY', currency: 'USD' } as const
    const { streaks } = book([buy({ ...us, tradeDate: '2026-09-02' })])
    const plan = { symbol: 'AAPL', accountType: 'SPECIFIC', assetClass: 'US_EQUITY', entryDate: '2026-09-01' } as const
    expect(streakOfPlan(plan, streaks)?.anchorId).toBe('t1')
    expect(streakOfPlan({ ...plan, assetClass: 'JP_EQUITY' }, streaks)).toBeNull()
  })
})
