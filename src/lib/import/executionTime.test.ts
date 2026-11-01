import { describe, expect, it } from 'vitest'
import {
  carriedTimes,
  formatEt,
  formatJst,
  orderByTime,
  orderContradictsTimes,
  resolveExecutedAt,
  sessionWarning,
  timedMarket,
  toTimeInput,
} from './executionTime'

describe('resolveExecutedAt', () => {
  it('reads the time as JST on the trade date', () => {
    expect(resolveExecutedAt('2026-10-20', { time: '09:05', nextDay: false })?.toISOString()).toBe(
      '2026-10-20T00:05:00.000Z',
    )
  })

  it('moves to the next day for a fill after midnight JST', () => {
    expect(resolveExecutedAt('2026-10-31', { time: '00:30', nextDay: true })?.toISOString()).toBe(
      '2026-10-31T15:30:00.000Z',
    )
  })

  it('is null for a blank or malformed time', () => {
    expect(resolveExecutedAt('2026-10-20', { time: '', nextDay: false })).toBeNull()
    expect(resolveExecutedAt('2026-10-20', { time: '24:00', nextDay: false })).toBeNull()
    expect(resolveExecutedAt('2026-10-20', { time: '9:05', nextDay: false })).toBeNull()
  })

  it('round-trips through toTimeInput', () => {
    const input = { time: '01:15', nextDay: true }
    expect(toTimeInput('2026-10-20', resolveExecutedAt('2026-10-20', input))).toEqual(input)
    expect(toTimeInput('2026-10-20', null)).toEqual({ time: '', nextDay: false })
  })
})

describe('timedMarket', () => {
  it('asks every equity for a time, ETFs bought as stock included, and no fund', () => {
    expect(timedMarket('JP_EQUITY')).toBe('JP')
    expect(timedMarket('US_EQUITY')).toBe('US')
    expect(timedMarket('FUND')).toBeNull()
  })
})

describe('formatting', () => {
  it('shows a US fill in both zones, daylight saving included', () => {
    // 2026-10-21 00:30 JST is 10/20 11:30 EDT.
    const summer = resolveExecutedAt('2026-10-20', { time: '00:30', nextDay: true })!
    expect(formatJst(summer)).toBe('10/21 00:30 JST')
    expect(formatEt(summer)).toBe('10/20 11:30 ET')
    // After 1 November New York is on EST, an hour further behind.
    const winter = resolveExecutedAt('2026-11-10', { time: '00:30', nextDay: true })!
    expect(formatEt(winter)).toBe('11/10 10:30 ET')
  })
})

describe('sessionWarning', () => {
  const at = (date: string, time: string, nextDay = false) => resolveExecutedAt(date, { time, nextDay })!

  it('accepts the TSE session and PTS night trading', () => {
    expect(sessionWarning(at('2026-10-20', '09:00'), 'JP')).toBeNull()
    expect(sessionWarning(at('2026-10-20', '21:15'), 'JP')).toBeNull()
  })

  it('warns on a JP time no venue was open', () => {
    expect(sessionWarning(at('2026-10-20', '03:00'), 'JP')).toMatch(/Outside TSE/)
    expect(sessionWarning(at('2026-10-20', '16:30'), 'JP')).toMatch(/Outside TSE/)
  })

  it('accepts US extended hours and warns outside them', () => {
    // 22:00 JST is 09:00 EDT, pre-market.
    expect(sessionWarning(at('2026-10-20', '22:00'), 'US')).toBeNull()
    // 10:00 JST is 21:00 EDT the evening before.
    expect(sessionWarning(at('2026-10-20', '10:00'), 'US')).toMatch(/Outside US hours/)
  })

  it('warns when the +1 day lands a fill on the weekend', () => {
    // Friday 10/23, 23:00 JST + 1 day is Saturday 10:00 EDT.
    expect(sessionWarning(at('2026-10-23', '23:00', true), 'US')).toMatch(/Saturday/)
  })
})

interface Item {
  id: string
  pool: string
  at: Date | null
}
const item = (id: string, pool: string, time: string | null): Item => ({
  id,
  pool,
  at: time ? resolveExecutedAt('2026-10-20', { time, nextDay: false }) : null,
})
const ids = (items: Item[] | null) => items?.map((entry) => entry.id) ?? null
const pool = (entry: Item) => entry.pool
const time = (entry: Item) => entry.at

describe('orderByTime', () => {
  it('puts a fully timed pool in time order', () => {
    const day = [item('b1', 'A', '09:10'), item('b2', 'A', '13:00'), item('s1', 'A', '10:00')]
    expect(ids(orderByTime(day, pool, time))).toEqual(['b1', 's1', 'b2'])
  })

  it('leaves a pool alone while any of its trades lacks a time', () => {
    const day = [
      item('a1', 'A', '09:10'),
      item('b1', 'B', '11:00'),
      item('a2', 'A', null),
      item('b2', 'B', '09:30'),
    ]
    expect(ids(orderByTime(day, pool, time))).toEqual(['a1', 'b2', 'a2', 'b1'])
  })

  it('is null when no pool can be ordered', () => {
    expect(orderByTime([item('a1', 'A', '09:10'), item('a2', 'A', null)], pool, time)).toBeNull()
  })
})

describe('orderContradictsTimes', () => {
  it('flags a stored order that puts a later time first', () => {
    expect(orderContradictsTimes([item('s', 'A', '10:00'), item('b', 'A', '09:00')], pool, time)).toBe(true)
  })

  it('compares within a pool only, and skips untimed trades', () => {
    expect(
      orderContradictsTimes(
        [item('a', 'A', '10:00'), item('b', 'B', '09:00'), item('c', 'A', null), item('d', 'A', '11:00')],
        pool,
        time,
      ),
    ).toBe(false)
  })
})

describe('carriedTimes', () => {
  const fill = { symbol: '8729', accountType: 'SPECIFIC', side: 'BUY', tradeDate: '2026-09-15' }
  const at = resolveExecutedAt('2026-09-15', { time: '09:01', nextDay: false })!

  it('carries a time every regrouped fill shared to the replacements', () => {
    const out = carriedTimes(
      [
        { ...fill, executedAt: at },
        { ...fill, executedAt: new Date(at) },
      ],
      [
        { ...fill, id: 'n1' },
        { ...fill, id: 'n2' },
      ],
    )
    expect(out.get('n1')).toEqual(at)
    expect(out.get('n2')).toEqual(at)
  })

  it('carries nothing when the fills differed or one had no time', () => {
    const later = resolveExecutedAt('2026-09-15', { time: '10:30', nextDay: false })!
    expect(
      carriedTimes(
        [
          { ...fill, executedAt: at },
          { ...fill, executedAt: later },
        ],
        [{ ...fill, id: 'n1' }],
      ).size,
    ).toBe(0)
    expect(
      carriedTimes(
        [
          { ...fill, executedAt: null },
          { ...fill, executedAt: at },
        ],
        [{ ...fill, id: 'n1' }],
      ).size,
    ).toBe(0)
  })

  it('does not carry across sides or days', () => {
    const out = carriedTimes(
      [{ ...fill, executedAt: at }],
      [
        { ...fill, side: 'SELL', id: 'sell' },
        { ...fill, tradeDate: '2026-09-16', id: 'next' },
      ],
    )
    expect(out.size).toBe(0)
  })
})
