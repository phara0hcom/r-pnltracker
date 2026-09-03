import { describe, expect, it } from 'vitest'
import { calendarFor, isTradingDay, tradingDaysBetween } from './calendar'

describe('isTradingDay — 東証', () => {
  it('closes for the whole 年末年始 run, not just the national holiday', () => {
    // 1 January is the only 祝日 of the four; 2 and 3 January are ordinary
    // working days for everyone except the exchange.
    expect(isTradingDay('2025-12-31', 'JP')).toBe(false)
    expect(isTradingDay('2026-01-01', 'JP')).toBe(false)
    expect(isTradingDay('2026-01-02', 'JP')).toBe(false)
    expect(isTradingDay('2026-01-03', 'JP')).toBe(false)
    expect(isTradingDay('2026-01-05', 'JP')).toBe(true)
  })

  it('places the Happy Monday holidays on the right Monday', () => {
    expect(isTradingDay('2026-01-12', 'JP')).toBe(false) // 成人の日, 2nd Mon
    expect(isTradingDay('2026-07-20', 'JP')).toBe(false) // 海の日, 3rd Mon
    expect(isTradingDay('2026-10-12', 'JP')).toBe(false) // スポーツの日, 2nd Mon
  })

  it('computes the equinoxes rather than assuming a fixed date', () => {
    expect(isTradingDay('2026-03-20', 'JP')).toBe(false) // 春分の日
    expect(isTradingDay('2026-09-23', 'JP')).toBe(false) // 秋分の日
    // 2027 shifts a day — the whole reason these are derived.
    expect(isTradingDay('2027-03-21', 'JP')).toBe(false)
  })

  it('walks 振替休日 past an existing holiday instead of taking Monday', () => {
    // 3 May 2026 (憲法記念日) is a Sunday, but the 4th and 5th are already
    // holidays, so the substitute lands on Wednesday the 6th.
    expect(isTradingDay('2026-05-03', 'JP')).toBe(false)
    expect(isTradingDay('2026-05-04', 'JP')).toBe(false)
    expect(isTradingDay('2026-05-05', 'JP')).toBe(false)
    expect(isTradingDay('2026-05-06', 'JP')).toBe(false)
    expect(isTradingDay('2026-05-07', 'JP')).toBe(true)
  })

  it('bridges 国民の休日 between 敬老の日 and 秋分の日', () => {
    // 2026 is a Silver Week year: 21st is 敬老の日, 23rd 秋分の日, so the 22nd
    // becomes a holiday purely by being sandwiched.
    expect(isTradingDay('2026-09-21', 'JP')).toBe(false)
    expect(isTradingDay('2026-09-22', 'JP')).toBe(false)
    expect(isTradingDay('2026-09-23', 'JP')).toBe(false)
    expect(isTradingDay('2026-09-24', 'JP')).toBe(true)
  })

  it('does not treat an ordinary weekday next to one holiday as a bridge', () => {
    // 文化の日 is 3 November; the 4th must stay open.
    expect(isTradingDay('2026-11-03', 'JP')).toBe(false)
    expect(isTradingDay('2026-11-04', 'JP')).toBe(true)
  })
})

describe('isTradingDay — US', () => {
  it('observes a Saturday holiday on the preceding Friday', () => {
    // 4 July 2026 falls on a Saturday.
    expect(isTradingDay('2026-07-03', 'US')).toBe(false)
    expect(isTradingDay('2026-07-06', 'US')).toBe(true)
  })

  it('closes for Good Friday, which no fixed-date table would catch', () => {
    expect(isTradingDay('2026-04-03', 'US')).toBe(false) // Easter is 5 April
    expect(isTradingDay('2027-03-26', 'US')).toBe(false) // Easter is 28 March
  })

  it('starts Juneteenth in 2022 rather than back-dating it', () => {
    expect(isTradingDay('2021-06-18', 'US')).toBe(true)
    expect(isTradingDay('2026-06-19', 'US')).toBe(false)
  })

  it('keeps the two calendars independent', () => {
    // 敬老の日: 東証 shut, NYSE open.
    expect(isTradingDay('2026-09-21', 'JP')).toBe(false)
    expect(isTradingDay('2026-09-21', 'US')).toBe(true)
    // Thanksgiving: the reverse.
    expect(isTradingDay('2026-11-26', 'JP')).toBe(true)
    expect(isTradingDay('2026-11-26', 'US')).toBe(false)
  })
})

describe('tradingDaysBetween', () => {
  it('is half-open, so the entry day itself counts as zero days held', () => {
    expect(tradingDaysBetween('2026-06-01', '2026-06-01', 'JP')).toBe(0)
    expect(tradingDaysBetween('2026-06-01', '2026-06-02', 'JP')).toBe(1)
  })

  it('skips weekends', () => {
    // Friday to Monday is one session, not three days.
    expect(tradingDaysBetween('2026-06-05', '2026-06-08', 'JP')).toBe(1)
  })

  it('skips holidays, which is what keeps the time stop honest', () => {
    // 29 April 2026 (昭和の日) through Golden Week: only 30 April and 1 May
    // are sessions before the 7th reopens.
    expect(tradingDaysBetween('2026-04-28', '2026-05-06', 'JP')).toBe(2)
  })

  it('returns zero rather than a negative count for a reversed range', () => {
    expect(tradingDaysBetween('2026-06-10', '2026-06-01', 'JP')).toBe(0)
  })
})

describe('calendarFor', () => {
  it('routes US equities to the NYSE calendar and everything else to 東証', () => {
    expect(calendarFor('US_EQUITY')).toBe('US')
    expect(calendarFor('JP_EQUITY')).toBe('JP')
    expect(calendarFor('FUND')).toBe('JP')
  })
})
