import { describe, expect, it } from 'vitest'
import { summarizeMonth } from './monthSummary'

const day = (date: string, tradeCount: number, realizedJpy: string | null) => ({ date, tradeCount, realizedJpy })

describe('summarizeMonth', () => {
  const month = [
    day('2026-09-01', 2, null),
    day('2026-09-02', 1, '23900'),
    day('2026-09-03', 2, '-51277'),
    day('2026-09-04', 0, null),
    day('2026-09-07', 2, '45800'),
    day('2026-09-08', 1, '0'),
  ]

  it('counts green and red among the days that closed', () => {
    const summary = summarizeMonth(month)
    expect(summary.tradingDays).toBe(5)
    expect(summary.closeDays).toBe(4)
    expect(summary.greenDays).toBe(2)
    expect(summary.redDays).toBe(1)
  })

  it('names the best and worst day', () => {
    const summary = summarizeMonth(month)
    expect(summary.best).toEqual({ date: '2026-09-07', realizedJpy: '45800' })
    expect(summary.worst).toEqual({ date: '2026-09-03', realizedJpy: '-51277' })
  })

  it('averages over every trading day, buys-only days included', () => {
    // 23,900 − 51,277 + 45,800 + 0 = 18,423 over five days.
    expect(summarizeMonth(month).avgPerTradingDayJpy).toBe('3685')
  })

  it('does not name one day as both best and worst', () => {
    const summary = summarizeMonth([day('2026-09-02', 1, '-4000'), day('2026-09-03', 1, null)])
    expect(summary.best).toEqual({ date: '2026-09-02', realizedJpy: '-4000' })
    expect(summary.worst).toBeNull()
  })

  it('copes with a month without trades', () => {
    const summary = summarizeMonth([day('2026-09-01', 0, null)])
    expect(summary.best).toBeNull()
    expect(summary.avgPerTradingDayJpy).toBeNull()
  })
})
