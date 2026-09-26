/**
 * The client-side grid has to agree with the server's day list exactly: the
 * placeholder squares it draws are replaced in place by `getCalendar`'s rows,
 * so a mismatched length or an off-by-one weekday would make the whole month
 * jump the moment the data lands.
 */
import { describe, expect, it } from 'vitest'
import { monthGrid, monthWeeks, shiftMonth } from './monthGrid'

describe('monthGrid', () => {
  it('covers the month, zero-padded and in order', () => {
    const { dates } = monthGrid('2026-08')
    expect(dates).toHaveLength(31)
    expect(dates[0]).toBe('2026-08-01')
    expect(dates[30]).toBe('2026-08-31')
  })

  it('gets February right in common and leap years', () => {
    expect(monthGrid('2026-02').dates).toHaveLength(28)
    expect(monthGrid('2024-02').dates).toHaveLength(29)
  })

  it('offsets a Monday-first grid from the weekday of the 1st', () => {
    // 2026-08-01 is a Saturday: five blanks precede it (Mon–Fri).
    expect(monthGrid('2026-08').leadingBlanks).toBe(5)
    // 2026-06-01 is a Monday and needs none.
    expect(monthGrid('2026-06').leadingBlanks).toBe(0)
    // 2026-11-01 is a Sunday — the case a Sunday-based getUTCDay() gets wrong.
    expect(monthGrid('2026-11').leadingBlanks).toBe(6)
  })
})

describe('monthWeeks', () => {
  it('cuts the month at each Sunday, clipping the weeks at either end', () => {
    // 2026-09-01 is a Tuesday and the 30th a Wednesday.
    const weeks = monthWeeks('2026-09')
    expect(weeks.map((week) => [week[0], week.at(-1)])).toEqual([
      ['2026-09-01', '2026-09-06'],
      ['2026-09-07', '2026-09-13'],
      ['2026-09-14', '2026-09-20'],
      ['2026-09-21', '2026-09-27'],
      ['2026-09-28', '2026-09-30'],
    ])
  })

  it('keeps every day exactly once', () => {
    for (const month of ['2026-02', '2026-06', '2026-08', '2026-11']) {
      expect(monthWeeks(month).flat()).toEqual(monthGrid(month).dates)
    }
  })

  it('gives a month starting on Sunday a one-day first week', () => {
    expect(monthWeeks('2026-11')[0]).toEqual(['2026-11-01'])
  })

  it('needs six rows for a long month starting late in the week', () => {
    // 2026-08-01 is a Saturday: 2 + 7 × 4 + 1 days.
    expect(monthWeeks('2026-08')).toHaveLength(6)
  })
})

describe('shiftMonth', () => {
  it('crosses year boundaries in both directions', () => {
    expect(shiftMonth('2026-08', 1)).toBe('2026-09')
    expect(shiftMonth('2026-12', 1)).toBe('2027-01')
    expect(shiftMonth('2026-01', -1)).toBe('2025-12')
  })
})
