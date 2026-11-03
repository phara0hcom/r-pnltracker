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
  timeEdit,
  toTimeInput,
  type DayOffset,
  type TimeInput,
} from './executionTime'

describe('resolveExecutedAt', () => {
  it('reads the time as JST on the trade date', () => {
    expect(resolveExecutedAt('2026-10-20', { time: '09:05', dayOffset: 0 })?.toISOString()).toBe(
      '2026-10-20T00:05:00.000Z',
    )
  })

  it('moves to the next day for a fill after midnight JST', () => {
    expect(resolveExecutedAt('2026-10-31', { time: '00:30', dayOffset: 1 })?.toISOString()).toBe(
      '2026-10-31T15:30:00.000Z',
    )
  })

  it('is null for a blank or malformed time', () => {
    expect(resolveExecutedAt('2026-10-20', { time: '', dayOffset: 0 })).toBeNull()
    expect(resolveExecutedAt('2026-10-20', { time: '24:00', dayOffset: 0 })).toBeNull()
    expect(resolveExecutedAt('2026-10-20', { time: '9:05', dayOffset: 0 })).toBeNull()
  })

  it('round-trips through toTimeInput on either side of the trade date', () => {
    for (const dayOffset of [-1, 0, 1] as const) {
      const input = { time: '01:15', dayOffset }
      expect(toTimeInput('2026-10-20', resolveExecutedAt('2026-10-20', input))).toEqual(input)
    }
    expect(toTimeInput('2026-10-20', null)).toEqual({ time: '', dayOffset: 0 })
  })

  it('keeps the instant of a pre-midnight fill that a restatement re-dated', () => {
    // Entered as 09-03 23:45 JST, then restated from 09-03 to 09-04.
    const input = toTimeInput('2026-09-04', new Date('2026-09-03T14:45:00Z'))
    expect(input).toEqual({ time: '23:45', dayOffset: -1 })
    expect(resolveExecutedAt('2026-09-04', input)?.toISOString()).toBe('2026-09-03T14:45:00.000Z')
  })
})

describe('timeEdit', () => {
  const restated = { tradeDate: '2026-09-04', executedAt: '2026-09-03T14:45:00.000Z' }
  const shown = (stored: typeof restated): TimeInput => toTimeInput(stored.tradeDate, new Date(stored.executedAt))

  it('leaves a restated time alone when the owner touched nothing', () => {
    expect(timeEdit(restated, restated.tradeDate, shown(restated))).toBeUndefined()
  })

  it('leaves alone a time too far from the trade date to show exactly', () => {
    const far = { tradeDate: '2026-09-10', executedAt: '2026-09-03T14:45:00.000Z' }
    expect(timeEdit(far, far.tradeDate, shown(far))).toBeUndefined()
  })

  it('writes a time the owner changed, and clears one they emptied', () => {
    expect(timeEdit(restated, restated.tradeDate, { time: '23:50', dayOffset: -1 })).toBe('2026-09-03T14:50:00.000Z')
    expect(timeEdit(restated, restated.tradeDate, { time: '', dayOffset: 0 })).toBeNull()
  })

  it('writes a first time, and nothing for a row that stays blank', () => {
    const blank = { tradeDate: '2026-09-04', executedAt: null }
    expect(timeEdit(blank, blank.tradeDate, { time: '09:05', dayOffset: 0 })).toBe('2026-09-04T00:05:00.000Z')
    expect(timeEdit(blank, blank.tradeDate, { time: '', dayOffset: 0 })).toBeUndefined()
  })

  it('moves the time with a date changed by hand', () => {
    const stored = { tradeDate: '2026-10-20', executedAt: '2026-10-20T00:05:00.000Z' }
    expect(timeEdit(stored, '2026-10-21', shown(stored))).toBe('2026-10-21T00:05:00.000Z')
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
    const summer = resolveExecutedAt('2026-10-20', { time: '00:30', dayOffset: 1 })!
    expect(formatJst(summer)).toBe('10/21 00:30 JST')
    expect(formatEt(summer)).toBe('10/20 11:30 ET')
    // After 1 November New York is on EST, an hour further behind.
    const winter = resolveExecutedAt('2026-11-10', { time: '00:30', dayOffset: 1 })!
    expect(formatEt(winter)).toBe('11/10 10:30 ET')
  })
})

describe('sessionWarning', () => {
  const at = (date: string, time: string, dayOffset: DayOffset = 0) => resolveExecutedAt(date, { time, dayOffset })!

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
    expect(sessionWarning(at('2026-10-23', '23:00', 1), 'US')).toMatch(/Saturday/)
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
  at: time ? resolveExecutedAt('2026-10-20', { time, dayOffset: 0 }) : null,
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
  const at = resolveExecutedAt('2026-09-15', { time: '09:01', dayOffset: 0 })!

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
    const later = resolveExecutedAt('2026-09-15', { time: '10:30', dayOffset: 0 })!
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

describe('resolveExecutedAt with a date still being typed', () => {
  it('reads as blank rather than as an Invalid Date', () => {
    for (const dayOffset of [-1, 0, 1] as const) {
      expect(resolveExecutedAt('', { time: '10:30', dayOffset })).toBeNull()
    }
  })
})
