import Decimal from 'decimal.js'
import { describe, expect, it } from 'vitest'
import type { NormalizedTrade } from '../domain/types'
import {
  attachAnnotations,
  holdingStreaks,
  legsOf,
  linkCandidates,
  linkedPlanDate,
  pairTypedLegs,
  planShares,
  realStatus,
  resolvePosition,
  type PositionAnchor,
  type StreakTrade,
} from './streaks'
import { makeTrade, US_TRADE } from '~/test/trade'

const d = (value: number | string) => new Decimal(value)

let serial = 0
function rec(
  side: NormalizedTrade['side'],
  date: string,
  qty: number,
  price = 100,
  over: Partial<NormalizedTrade> & { id?: string } = {},
): StreakTrade {
  serial += 1
  const { id, ...trade } = over
  return {
    id: id ?? `t${String(serial)}`,
    trade: makeTrade({ side, tradeDate: date, quantity: d(qty), unitPrice: d(price), ...trade }),
  }
}

const anchor = (over: Partial<PositionAnchor> = {}): PositionAnchor => ({
  symbol: '8411',
  accountType: 'SPECIFIC',
  assetClass: 'JP_EQUITY',
  entryDate: '2026-09-01',
  anchorTradeId: null,
  ...over,
})

const ids = (records: StreakTrade[]) => records.map((record) => record.id)

describe('holdingStreaks', () => {
  it('keeps a top-up in the same streak and blends its entry price', () => {
    const [streak, ...rest] = holdingStreaks([
      rec('BUY', '2026-09-01', 100, 100, { id: 'b1' }),
      rec('BUY', '2026-09-03', 100, 110, { id: 'b2' }),
    ])
    expect(rest).toEqual([])
    expect(streak!.anchorId).toBe('b1')
    expect(streak!.entryPrice.toFixed()).toBe('105')
    expect(streak!.sharesHeld.toFixed()).toBe('200')
    expect(streak!.closeDate).toBeNull()
  })

  it('keeps a Target 1 partial in the streak, and closes it on the final sell', () => {
    const [streak] = holdingStreaks([
      rec('BUY', '2026-09-01', 200),
      rec('SELL', '2026-09-05', 100),
      rec('SELL', '2026-09-10', 100),
    ])
    expect(streak!.trades).toHaveLength(3)
    expect(streak!.sharesSold.toFixed()).toBe('200')
    expect(streak!.closeDate).toBe('2026-09-10')
  })

  it('starts a new streak on re-entry after a close', () => {
    const streaks = holdingStreaks([
      rec('BUY', '2026-09-01', 100, 100, { id: 'a' }),
      rec('SELL', '2026-09-05', 100),
      rec('BUY', '2026-09-08', 100, 100, { id: 'c' }),
    ])
    expect(streaks.map((streak) => [streak.anchorId, streak.closeDate, streak.priorCloseDate])).toEqual([
      ['a', '2026-09-05', null],
      ['c', null, '2026-09-05'],
    ])
  })

  it('takes a same-day round trip opens first', () => {
    const streaks = holdingStreaks([
      rec('SELL', '2026-09-01', 100, 100, { id: 's' }),
      rec('BUY', '2026-09-01', 100, 100, { id: 'b' }),
    ])
    expect(streaks).toHaveLength(1)
    expect(ids(streaks[0]!.trades)).toEqual(['b', 's'])
    expect(streaks[0]!.closeDate).toBe('2026-09-01')
  })

  it('honours a hand-set day order, which can split a day into two streaks', () => {
    // Buy 100, sell 100, buy 50 — the second buy reopens the pool.
    const streaks = holdingStreaks([
      rec('BUY', '2026-09-01', 100, 100, { id: 'b1', daySequence: 0 }),
      rec('BUY', '2026-09-01', 50, 100, { id: 'b2', daySequence: 2 }),
      rec('SELL', '2026-09-01', 100, 100, { id: 's', daySequence: 1 }),
    ])
    expect(streaks.map((streak) => ids(streak.trades))).toEqual([['b1', 's'], ['b2']])
  })

  it('leaves out sells from before the history began', () => {
    const streaks = holdingStreaks([rec('SELL', '2026-08-20', 100), rec('BUY', '2026-09-01', 100, 100, { id: 'b' })])
    expect(streaks).toHaveLength(1)
    expect(streaks[0]!.anchorId).toBe('b')
    expect(streaks[0]!.priorCloseDate).toBe('2026-08-20')
    expect(streaks[0]!.closeDate).toBeNull()
  })

  it('keeps pools apart, so the same ticker in NISA is its own streak', () => {
    const streaks = holdingStreaks([
      rec('BUY', '2026-09-01', 100),
      rec('BUY', '2026-09-01', 100, 100, { accountType: 'NISA_GROWTH' }),
    ])
    expect(streaks.map((streak) => streak.accountType).sort()).toEqual(['NISA_GROWTH', 'SPECIFIC'])
  })
})

describe('resolvePosition', () => {
  it('is unlinked while there is no anchor', () => {
    expect(resolvePosition(anchor(), [])).toEqual({ kind: 'UNLINKED' })
    expect(realStatus({ kind: 'UNLINKED' })).toBe('AWAITING_IMPORT')
  })

  it('follows the anchor id through a US re-dating', () => {
    // The row is updated in place: same id, 約定日 one day later.
    const streaks = holdingStreaks([
      rec('BUY', '2026-09-04', 10, 15, { ...US_TRADE, symbol: 'CAG', id: 'cag-buy' }),
    ])
    const found = resolvePosition(
      anchor({ symbol: 'CAG', assetClass: 'US_EQUITY', entryDate: '2026-09-03', anchorTradeId: 'cag-buy' }),
      streaks,
    )
    expect(found).toMatchObject({ kind: 'FOUND', via: 'ANCHOR' })
    expect(realStatus(found)).toBe('OPEN')
  })

  it('falls back to the entry date when settlement regrouped the anchor away', () => {
    const streaks = holdingStreaks([
      rec('BUY', '2026-09-15', 1800, 160, { id: 'regrouped' }),
      rec('SELL', '2026-09-20', 1800, 170),
    ])
    const found = resolvePosition(anchor({ entryDate: '2026-09-15', anchorTradeId: 'gone' }), streaks)
    expect(found).toMatchObject({ kind: 'FOUND', via: 'FALLBACK' })
    expect(realStatus(found)).toBe('CLOSED')
  })

  it('accepts the day after for a US pool only', () => {
    const us = holdingStreaks([rec('BUY', '2026-09-04', 10, 15, { ...US_TRADE, symbol: 'CAG' })])
    expect(
      resolvePosition(
        anchor({ symbol: 'CAG', assetClass: 'US_EQUITY', entryDate: '2026-09-03', anchorTradeId: 'gone' }),
        us,
      ).kind,
    ).toBe('FOUND')
    const jp = holdingStreaks([rec('BUY', '2026-09-02', 100)])
    expect(resolvePosition(anchor({ entryDate: '2026-09-01', anchorTradeId: 'gone' }), jp)).toEqual({
      kind: 'MISSING',
    })
  })
})

describe('legsOf', () => {
  it('groups fills by side and day, one leg per decision', () => {
    const [streak] = holdingStreaks([
      rec('BUY', '2026-09-01', 100, 100, { id: 'f1' }),
      rec('BUY', '2026-09-01', 300, 104, { id: 'f2' }),
      rec('BUY', '2026-09-03', 100, 110, { id: 'f3' }),
      rec('SELL', '2026-09-08', 500, 120, { id: 'f4' }),
    ])
    const legs = legsOf(streak!)
    expect(legs.map((leg) => [leg.side, leg.date, leg.firstTradeId, leg.fills.length, leg.quantity.toFixed()])).toEqual([
      ['ENTRY', '2026-09-01', 'f1', 2, '400'],
      ['ENTRY', '2026-09-03', 'f3', 1, '100'],
      ['EXIT', '2026-09-08', 'f4', 1, '500'],
    ])
    expect(legs[0]!.averagePrice.toFixed()).toBe('103')
  })
})

describe('attachAnnotations', () => {
  const [streak] = holdingStreaks([
    rec('BUY', '2026-09-01', 100, 100, { id: 'f1' }),
    rec('SELL', '2026-09-08', 100, 120, { id: 'f2' }),
  ])
  const legs = legsOf(streak!)

  it('matches by first fill, then by side and date, and lists what matches nothing', () => {
    const { byLeg, unattached } = attachAnnotations(legs, [
      { id: 'a1', side: 'ENTRY', date: '2026-09-01', firstTradeId: 'f1' },
      { id: 'a2', side: 'EXIT', date: '2026-09-08', firstTradeId: 'regrouped-away' },
      { id: 'a3', side: 'EXIT', date: '2026-09-09', firstTradeId: null },
    ])
    expect(byLeg.get('f1')?.id).toBe('a1')
    expect(byLeg.get('f2')?.id).toBe('a2')
    expect(unattached.map((annotation) => annotation.id)).toEqual(['a3'])
  })
})

describe('linkedPlanDate', () => {
  const plan = (assetClass: PositionAnchor['assetClass']) => ({ assetClass, entryDate: '2026-11-01' })

  it('follows the streak', () => {
    expect(linkedPlanDate(plan('JP_EQUITY'), '2026-11-05')).toBe('2026-11-05')
    expect(linkedPlanDate(plan('US_EQUITY'), '2026-11-05')).toBe('2026-11-05')
    expect(linkedPlanDate(plan('US_EQUITY'), '2026-10-31')).toBe('2026-10-31')
  })

  it('treats a US streak one day later as Rakuten’s re-dating, not a correction', () => {
    expect(linkedPlanDate(plan('US_EQUITY'), '2026-11-02')).toBe('2026-11-01')
    expect(linkedPlanDate(plan('JP_EQUITY'), '2026-11-02')).toBe('2026-11-02')
  })
})

describe('linkCandidates', () => {
  it('offers streaks of the pool from the day before entry on, not already claimed', () => {
    const streaks = holdingStreaks([
      rec('BUY', '2026-08-01', 100, 100, { id: 'old' }),
      rec('SELL', '2026-08-05', 100),
      rec('BUY', '2026-08-31', 100, 100, { id: 'day-before' }),
      rec('SELL', '2026-09-02', 100),
      rec('BUY', '2026-09-03', 100, 100, { id: 'claimed' }),
      rec('SELL', '2026-09-04', 100),
      rec('BUY', '2026-09-05', 100, 100, { id: 'later' }),
    ])
    expect(
      linkCandidates(anchor(), streaks, new Set(['claimed'])).map((streak) => streak.anchorId),
    ).toEqual(['day-before', 'later'])
  })
})

describe('pairTypedLegs', () => {
  it('pairs by side then in order, and writes a typed time only to fills without one', () => {
    const at = new Date('2026-09-01T00:30:00Z')
    const kept = new Date('2026-09-01T01:00:00Z')
    const fills: StreakTrade[] = [
      { ...rec('BUY', '2026-09-01', 100, 100, { id: 'f1' }) },
      { ...rec('BUY', '2026-09-01', 100, 100, { id: 'f2' }), executedAt: kept },
      rec('SELL', '2026-09-08', 200, 120, { id: 'f3' }),
    ]
    const legs = legsOf(holdingStreaks(fills)[0]!)
    const { pairs, times } = pairTypedLegs(
      [
        { id: 'tx', side: 'EXIT', quantity: d(200), executedAt: null },
        { id: 'te', side: 'ENTRY', quantity: d(200), executedAt: at },
        { id: 'te2', side: 'ENTRY', quantity: d(50), executedAt: null },
      ],
      legs,
    )
    expect(pairs.map((pair) => [pair.typedId, pair.leg.firstTradeId])).toEqual([
      ['te', 'f1'],
      ['tx', 'f3'],
    ])
    expect([...times]).toEqual([['f1', at]])
  })
})

describe('planShares', () => {
  it('reads a linked position from its streak', () => {
    const [streak] = holdingStreaks([rec('BUY', '2026-09-01', 300), rec('SELL', '2026-09-05', 100)])
    const shares = planShares(streak!, [{ side: 'ENTRY', quantity: d(999) }])
    expect([shares.sharesRemaining.toFixed(), shares.sharesSold.toFixed()]).toEqual(['200', '100'])
  })

  it('reads a position awaiting import from its typed legs', () => {
    const shares = planShares(null, [
      { side: 'ENTRY', quantity: d(300) },
      { side: 'EXIT', quantity: d(100) },
    ])
    expect([shares.sharesRemaining.toFixed(), shares.sharesSold.toFixed()]).toEqual(['200', '100'])
  })
})
