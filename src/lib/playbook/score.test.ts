import Decimal from 'decimal.js'
import { describe, expect, it } from 'vitest'
import {
  combineScore,
  outcomeRatingFor,
  piecewise,
  reviewFigures,
  riskRatingFor,
  type LegFigures,
  type ReviewInput,
} from './score'
import { playbookStats } from './stats'

const d = (value: string | number) => new Decimal(value)

const leg = (
  kind: LegFigures['kind'],
  price: number,
  quantity: number,
  rating: number | null = null,
  fee = 0,
): LegFigures => ({ kind, price: d(price), quantity: d(quantity), fee: d(fee), rating })

const paper = (overrides: Partial<ReviewInput>): ReviewInput => ({
  kind: 'PAPER',
  legs: [],
  stopPrice: null,
  targetPrice: null,
  accountEquity: null,
  riskRatingOverride: null,
  realizedNative: null,
  ...overrides,
})

describe('piecewise', () => {
  const points = [
    [0, 0],
    [10, 100],
  ] as const
  it('interpolates and holds flat past the ends', () => {
    expect(piecewise(5, points)).toBe(50)
    expect(piecewise(-3, points)).toBe(0)
    expect(piecewise(30, points)).toBe(100)
  })
})

describe('riskRatingFor', () => {
  it('rewards 1% risk and punishes 5%', () => {
    expect(riskRatingFor(d('0.01'), null)).toBe(9)
    expect(riskRatingFor(d('0.05'), null)).toBe(1)
  })

  it('pulls a careful stop down when the position is most of the account', () => {
    // 1% risk on a position worth 75% of the account — a gap ignores the stop.
    expect(riskRatingFor(d('0.01'), d('0.75'))).toBe(6.6)
  })

  it('is unknown with neither figure', () => {
    expect(riskRatingFor(null, null)).toBeNull()
  })
})

describe('outcomeRatingFor', () => {
  it('scores a stop taken at -1R as a 3, not a failure', () => {
    expect(outcomeRatingFor(d(-1), null)).toBe(3)
    expect(outcomeRatingFor(d(2), null)).toBe(9)
  })

  it('falls back to the return when there is no stop', () => {
    expect(outcomeRatingFor(null, d('0.05'))).toBe(7)
  })
})

describe('combineScore', () => {
  it('reweights around a missing component and says so', () => {
    const score = combineScore({ entry: 8, exit: null, risk: 6, outcome: null })
    expect(score.overall).toBe(7)
    expect(score.provisional).toBe(true)
    expect(score.components.map((part) => part.weight)).toEqual([0.5, 0.5])
  })

  it('weights process three to one against the result', () => {
    // A perfect result on a careless trade still scores under half.
    const score = combineScore({ entry: 2, exit: 2, risk: 1, outcome: 10 })
    expect(score.overall).toBe(3.8)
    expect(score.provisional).toBe(false)
  })
})

describe('reviewFigures', () => {
  it('measures R, risk and size from the legs', () => {
    const figures = reviewFigures(
      paper({
        legs: [leg('ENTRY', 1000, 100, 8), leg('EXIT', 1100, 100, 6)],
        stopPrice: d(950),
        targetPrice: d(1100),
        accountEquity: d(1_000_000),
      }),
    )
    expect(figures.pnl?.toString()).toBe('10000')
    expect(figures.riskAmount?.toString()).toBe('5000')
    expect(figures.riskPct?.toString()).toBe('0.005')
    expect(figures.sizePct?.toString()).toBe('0.1')
    expect(figures.rMultiple?.toString()).toBe('2')
    expect(figures.plannedR?.toString()).toBe('2')
    expect(figures.riskRating).toBe(10)
    expect(figures.outcomeRating).toBe(9)
    expect(figures.score.overall).toBe(8.3)
    expect(figures.score.provisional).toBe(false)
  })

  it('weights scale-in ratings by size and charges fees to the closed units', () => {
    const figures = reviewFigures(
      paper({
        legs: [
          leg('ENTRY', 100, 300, 9, 30),
          leg('ENTRY', 110, 100, 1, 10),
          leg('EXIT', 120, 200, 7, 20),
        ],
        stopPrice: d(95),
      }),
    )
    expect(figures.avgEntry?.toString()).toBe('102.5')
    expect(figures.entryRating).toBe(7)
    // Half the units closed: 200 × 120 − 20 − (200 × 102.5 + 20 of the 40 entry fees).
    expect(figures.pnl?.toString()).toBe('3460')
    expect(figures.open).toBe(true)
    expect(figures.score.provisional).toBe(true)
  })

  it('takes a real trade’s result from the engine, not the legs', () => {
    const figures = reviewFigures({
      ...paper({ legs: [leg('ENTRY', 1000, 100), leg('EXIT', 1100, 100)] }),
      kind: 'REAL',
      realizedNative: d(9_412),
    })
    expect(figures.pnl?.toString()).toBe('9412')
  })

  it('has no R when the stop is above the entry', () => {
    const figures = reviewFigures(
      paper({ legs: [leg('ENTRY', 100, 10), leg('EXIT', 90, 10)], stopPrice: d(120) }),
    )
    expect(figures.rMultiple).toBeNull()
    expect(figures.outcomeRating).toBe(1)
  })

  it('lets a hand-set risk rating replace the computed one', () => {
    const figures = reviewFigures(
      paper({
        legs: [leg('ENTRY', 100, 10)],
        stopPrice: d(99),
        accountEquity: d(10_000),
        riskRatingOverride: 4,
      }),
    )
    expect(figures.riskRatingAuto).toBe(10)
    expect(figures.riskRating).toBe(4)
  })
})

describe('playbookStats', () => {
  it('counts only closed trades towards the results', () => {
    const stats = playbookStats([
      { kind: 'REAL', open: false, pnl: d(100), rMultiple: d(2), overall: 8 },
      { kind: 'REAL', open: false, pnl: d(-50), rMultiple: d(-1), overall: 5 },
      { kind: 'REAL', open: true, pnl: d(500), rMultiple: d(5), overall: null },
    ])
    expect(stats.closed).toBe(2)
    expect(stats.winRate).toBe(0.5)
    expect(stats.avgR?.toString()).toBe('0.5')
    expect(stats.avgScore).toBe(6.5)
  })
})
