import Decimal from 'decimal.js'
import { describe, expect, it } from 'vitest'
import { paperResult, paperStatus, type PaperLeg } from './paper'
import { curve, overallScore, ratedLegs, resultScore, riskScore, rMultiple } from './score'
import { kindsUsed, rankBestWorst, rankingsByKind, setupStats, type ScoredPosition } from './stats'
import { extraTargetsProblem, ratingProblem, staticPlanProblem } from './validate'

const d = (value: number | string) => new Decimal(value)

describe('curve', () => {
  const points = [
    [0, 0],
    [10, 100],
  ] as const
  it('interpolates between points and is flat beyond them', () => {
    expect(curve(points, 2.5)).toBe(25)
    expect(curve(points, -5)).toBe(0)
    expect(curve(points, 50)).toBe(100)
  })
})

describe('ratedLegs', () => {
  it('weights ratings by quantity', () => {
    expect(
      ratedLegs([
        { rating: 9, quantity: d(300) },
        { rating: 5, quantity: d(100) },
      ]),
    ).toEqual({ score: 8, complete: true })
  })

  it('scores the rated legs but marks an unrated one incomplete', () => {
    expect(
      ratedLegs([
        { rating: 6, quantity: d(100) },
        { rating: null, quantity: d(100) },
      ]),
    ).toEqual({ score: 6, complete: false })
    expect(ratedLegs([{ rating: null, quantity: d(100) }]).score).toBeNull()
  })
})

describe('riskScore', () => {
  const base = { entryPrice: d(1000), shares: d(100), equity: d(10_000_000), override: null }

  it('blends loss at stop (70%) with position cost (30%)', () => {
    // Loss ¥10,000 = 0.1% → 10; cost ¥100,000 = 1% → 10.
    expect(riskScore({ ...base, stop: d(900) })).toBeCloseTo(10)
    // Loss ¥200,000 = 2% → 6; cost ¥1,000,000 = 10% → 10.
    expect(riskScore({ ...base, shares: d(1000), stop: d(800) })).toBeCloseTo(0.7 * 6 + 0.3 * 10)
    // Loss 1.5% → 7.5; cost 20% → 8.
    expect(riskScore({ ...base, shares: d(2000), stop: d(925) })).toBeCloseTo(0.7 * 7.5 + 0.3 * 8)
  })

  it('takes the override, and is null without a stop or an account size', () => {
    expect(riskScore({ ...base, stop: null, override: 4 })).toBe(4)
    expect(riskScore({ ...base, stop: null })).toBeNull()
    expect(riskScore({ ...base, stop: d(900), equity: null })).toBeNull()
  })
})

describe('rMultiple and resultScore', () => {
  it('divides the result by the risk on the units closed', () => {
    expect(rMultiple(d(20_000), d(100), d(100))?.toFixed()).toBe('2')
    expect(rMultiple(d(20_000), null, d(100))).toBeNull()
    expect(rMultiple(d(20_000), d(0), d(100))).toBeNull()
  })

  it('scores by R, and by return without a stop', () => {
    expect(resultScore(d(2), null)).toBe(9)
    expect(resultScore(d(-1.5), null)).toBe(2)
    expect(resultScore(null, d('0.075'))).toBe(8)
    expect(resultScore(null, null)).toBeNull()
  })
})

describe('overallScore', () => {
  it('weighs the four parts equally', () => {
    expect(overallScore({ entry: 8, exit: 6, risk: 10, result: 4 }, { open: false, complete: true })).toMatchObject({
      overall: 7,
      provisional: false,
    })
  })

  it('reweights around a missing part and marks it provisional', () => {
    expect(overallScore({ entry: 8, exit: null, risk: 6, result: null }, { open: true, complete: true })).toMatchObject({
      overall: 7,
      provisional: true,
    })
  })

  it('is provisional while a leg is unrated, even with all four parts', () => {
    expect(
      overallScore({ entry: 8, exit: 6, risk: 10, result: 4 }, { open: false, complete: false }).provisional,
    ).toBe(true)
  })
})

describe('paperResult', () => {
  const leg = (side: 'ENTRY' | 'EXIT', date: string, quantity: number, price: number, fee = 0): PaperLeg => ({
    side,
    date,
    executedAt: null,
    price: d(price),
    quantity: d(quantity),
    fee: d(fee),
  })

  it('realizes at moving-average cost, fees included', () => {
    const result = paperResult([
      leg('ENTRY', '2026-09-01', 100, 100, 100),
      leg('ENTRY', '2026-09-02', 100, 120, 100),
      leg('EXIT', '2026-09-05', 100, 130, 50),
    ])
    // Average cost (10,100 + 12,100) / 200 = 111 a share.
    expect(result.realized.toFixed()).toBe('1850')
    expect(result.costClosed.toFixed()).toBe('11100')
    expect(result.entryPrice?.toFixed()).toBe('110')
    expect(paperStatus(result)).toBe('OPEN')
  })

  it('closes when everything is sold, clamping an oversized sale', () => {
    const result = paperResult([leg('ENTRY', '2026-09-01', 100, 100), leg('EXIT', '2026-09-05', 150, 90)])
    expect(result.sharesSold.toFixed()).toBe('100')
    expect(result.realized.toFixed()).toBe('-1000')
    expect(result.returnPct?.toFixed()).toBe('-0.1')
    expect(paperStatus(result)).toBe('CLOSED')
  })
})

describe('setupStats', () => {
  const position = (over: Partial<ScoredPosition>): ScoredPosition => ({
    id: 'p',
    kind: 'REAL',
    status: 'CLOSED',
    result: d(1),
    r: null,
    overall: null,
    ...over,
  })

  it('counts closed positions only, real and paper apart, averaging R over those that have one', () => {
    const stats = setupStats([
      position({ result: d(5000), r: d(2), overall: 8 }),
      position({ result: d(-2000), r: null, overall: 4 }),
      position({ result: d(0), r: d(-1), overall: null }),
      position({ status: 'OPEN', result: null, r: d(5), overall: 9 }),
      position({ kind: 'PAPER', result: d(10) }),
    ])
    expect(stats.REAL).toMatchObject({ closed: 3, wins: 1, withR: 2, withScore: 2, averageScore: 6 })
    expect(stats.REAL.winRate).toBeCloseTo(1 / 3)
    expect(stats.REAL.averageR?.toFixed()).toBe('0.5')
    expect(stats.PAPER).toMatchObject({ closed: 1, wins: 1, averageR: null })
  })
})

describe('rankBestWorst', () => {
  const closed = (count: number) =>
    Array.from({ length: count }, (_, index): ScoredPosition => ({
      id: `p${String(index)}`,
      kind: 'REAL',
      status: 'CLOSED',
      result: d(index),
      r: index % 2 === 0 ? d(index) : null,
      overall: index,
    }))

  it('shows one ranked list under ten closed positions', () => {
    expect(rankBestWorst(closed(6), 'SCORE')).toEqual({ single: closed(6).reverse() })
  })

  it('splits into a best and a worst five from ten on', () => {
    const ranked = rankBestWorst(closed(12), 'SCORE')
    expect('best' in ranked && ranked.best.map((p) => p.id)).toEqual(['p11', 'p10', 'p9', 'p8', 'p7'])
    expect('worst' in ranked && ranked.worst.map((p) => p.id)).toEqual(['p0', 'p1', 'p2', 'p3', 'p4'])
  })

  it('ranks by R over only the positions that have one', () => {
    const ranked = rankBestWorst(closed(12), 'R')
    expect('single' in ranked && ranked.single.map((p) => p.id)).toEqual(['p10', 'p8', 'p6', 'p4', 'p2', 'p0'])
  })
})

describe('rankBestWorst at the boundary', () => {
  const closed = (count: number) =>
    Array.from({ length: count }, (_, index): ScoredPosition => ({
      id: `p${String(index)}`,
      kind: 'REAL',
      status: 'CLOSED',
      result: d(index),
      r: d(index),
      overall: index,
    }))

  it('keeps one list at nine, and at ten shares no trade between best and worst', () => {
    expect('single' in rankBestWorst(closed(9), 'SCORE')).toBe(true)
    const ranked = rankBestWorst(closed(10), 'SCORE')
    if (!('best' in ranked)) throw new Error('expected two lists')
    const ids = [...ranked.best, ...ranked.worst].map((position) => position.id)
    expect(new Set(ids).size).toBe(10)
  })

  it('falls back to one list when too few of ten or more have the figure', () => {
    const some = closed(12).map((position, index) => (index < 9 ? position : { ...position, r: null }))
    expect('best' in rankBestWorst(some, 'SCORE')).toBe(true)
    expect('single' in rankBestWorst(some, 'R')).toBe(true)
  })

  it('leaves an open position out, whatever its score', () => {
    const ranked = rankBestWorst([...closed(2), { ...closed(1)[0]!, id: 'open', status: 'OPEN', overall: 99 }], 'SCORE')
    expect('single' in ranked && ranked.single.map((position) => position.id)).toEqual(['p1', 'p0'])
  })
})

describe('rankingsByKind', () => {
  const position = (id: string, kind: ScoredPosition['kind'], overall: number): ScoredPosition => ({
    id,
    kind,
    status: 'CLOSED',
    result: d(1),
    r: d(overall),
    overall,
  })

  it('never ranks paper beside real', () => {
    const { REAL, PAPER } = rankingsByKind([position('r', 'REAL', 3), position('p', 'PAPER', 9)])
    expect('single' in REAL.SCORE && REAL.SCORE.single.map((item) => item.id)).toEqual(['r'])
    expect('single' in PAPER.R && PAPER.R.single.map((item) => item.id)).toEqual(['p'])
  })
})

describe('kindsUsed', () => {
  it('lists the kinds with any position, real first, and none for an unused setup', () => {
    expect(kindsUsed([])).toEqual([])
    expect(kindsUsed([{ kind: 'PAPER' }])).toEqual(['PAPER'])
    expect(kindsUsed([{ kind: 'PAPER' }, { kind: 'REAL' }])).toEqual(['REAL', 'PAPER'])
  })
})

describe('validation', () => {
  it('accepts whole ratings 1–10 only', () => {
    expect(ratingProblem(null)).toBeNull()
    expect(ratingProblem(10)).toBeNull()
    expect(ratingProblem(0)).not.toBeNull()
    expect(ratingProblem(7.5)).not.toBeNull()
  })

  it('refuses extra targets that sell more than the position', () => {
    expect(extraTargetsProblem([{ price: '120', fraction: '0.5' }, { price: '140', fraction: '0.5' }])).toBeNull()
    expect(extraTargetsProblem([{ price: '120', fraction: '0.6' }, { price: '140', fraction: '0.5' }])).toMatch(/more than/)
    expect(extraTargetsProblem([{ price: 'abc', fraction: '0.5' }])).toMatch(/price/)
  })

  it('keeps a static stop below entry and Target 1 above it', () => {
    expect(staticPlanProblem(d(100), d(90), d(120))).toBeNull()
    expect(staticPlanProblem(d(100), d(100), null)).toMatch(/stop/)
    expect(staticPlanProblem(d(100), null, d(95))).toMatch(/Target 1/)
  })
})
