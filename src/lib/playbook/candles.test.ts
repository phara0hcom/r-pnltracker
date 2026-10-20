import { describe, expect, it } from 'vitest'
import {
  candleTicker,
  normalizeInterval,
  parseCandleBody,
  parseYahooChart,
  placeFill,
  windowAround,
  yahooRequest,
  yahooSymbol,
  zonedInstant,
} from './candles'
import type { Candle } from './types'

const bar = (t: number, o = '10', h = '12', l = '9', c = '11'): Candle => ({
  t,
  o,
  h,
  l,
  c,
  v: null,
})

describe('normalizeInterval', () => {
  it('collapses TradingView’s spellings onto one', () => {
    expect(normalizeInterval('5')).toBe('5m')
    expect(normalizeInterval('60')).toBe('1h')
    expect(normalizeInterval('240')).toBe('4h')
    expect(normalizeInterval('D')).toBe('1D')
    expect(normalizeInterval('1D')).toBe('1D')
    expect(normalizeInterval('W')).toBe('1W')
    expect(normalizeInterval('1h')).toBe('1h')
  })

  it('refuses seconds and nonsense', () => {
    expect(normalizeInterval('30S')).toBeNull()
    expect(normalizeInterval('')).toBeNull()
    expect(normalizeInterval('daily')).toBeNull()
  })
})

describe('tickers', () => {
  it('uses TradingView’s ticker without the venue, and Yahoo’s suffixes', () => {
    expect(candleTicker('7203', 'JP_EQUITY')).toBe('7203')
    expect(candleTicker('BRK B', 'US_EQUITY')).toBe('BRK.B')
    expect(yahooSymbol('7203', 'JP_EQUITY')).toBe('7203.T')
    expect(yahooSymbol('BRK B', 'US_EQUITY')).toBe('BRK-B')
    expect(candleTicker('eMAXIS Slim 全世界株式', 'FUND')).toBeNull()
  })
})

describe('parseCandleBody', () => {
  it('reads the Pine script’s bar arrays, repairing its number format', () => {
    const parsed = parseCandleBody(
      '{"ticker":"aapl","exchange":"NASDAQ","interval":"60","bars":[[1700003600000,1,2,.5,1.5,100],[1700000000000,1,2,.5,1.5]]}',
    )
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.delivery.ticker).toBe('AAPL')
    expect(parsed.delivery.interval).toBe('1h')
    // Sorted oldest first, and a missing volume is null rather than zero.
    expect(parsed.delivery.bars.map((b) => b.t)).toEqual([1700000000000, 1700003600000])
    expect(parsed.delivery.bars[0]?.v).toBeNull()
    expect(parsed.delivery.bars[1]?.l).toBe('0.5')
  })

  it('accepts a single bar from placeholders, with the ISO time {{time}} gives', () => {
    const parsed = parseCandleBody(
      '{"ticker":"7203","interval":"D","time":"2026-10-19T15:00:00Z","open":"2800","high":"2850","low":"2790","close":"2840","volume":"1200000"}',
    )
    expect(parsed.ok && parsed.delivery.bars[0]?.t).toBe(Date.parse('2026-10-19T15:00:00Z'))
  })

  it('rejects a bar whose high is under its body', () => {
    const parsed = parseCandleBody('{"ticker":"X","interval":"5","bars":[[1,10,9,8,10]]}')
    expect(parsed.ok).toBe(false)
  })

  it('rejects na prices and too many bars', () => {
    expect(parseCandleBody('{"ticker":"X","interval":"5","bars":[[1,"NaN",2,1,1]]}').ok).toBe(false)
    const many = Array.from({ length: 101 }, (_, i) => [i + 1, 1, 1, 1, 1])
    expect(parseCandleBody(JSON.stringify({ ticker: 'X', interval: '5', bars: many })).ok).toBe(
      false,
    )
  })
})

describe('zonedInstant', () => {
  it('follows New York across daylight saving', () => {
    expect(new Date(zonedInstant('2026-07-01', '09:30', 'America/New_York')).toISOString()).toBe(
      '2026-07-01T13:30:00.000Z',
    )
    expect(new Date(zonedInstant('2026-12-01', '09:30', 'America/New_York')).toISOString()).toBe(
      '2026-12-01T14:30:00.000Z',
    )
    expect(new Date(zonedInstant('2026-10-20', '09:00', 'Asia/Tokyo')).toISOString()).toBe(
      '2026-10-20T00:00:00.000Z',
    )
  })
})

describe('placeFill', () => {
  const tokyo = 'Asia/Tokyo'
  // 5-minute bars from 09:00 JST on two days.
  const day1 = zonedInstant('2026-10-19', '09:00', tokyo)
  const day2 = zonedInstant('2026-10-20', '09:00', tokyo)
  const five = 5 * 60_000
  const bars = [0, 1, 2]
    .flatMap((i) => [bar(day1 + i * five), bar(day2 + i * five)])
    .sort((a, b) => a.t - b.t)

  it('marks the bar holding a timed fill', () => {
    expect(placeFill(bars, '5m', { date: '2026-10-20', time: '09:07' }, tokyo)).toEqual({
      kind: 'bar',
      index: 4,
    })
  })

  it('marks the whole day when the time is unknown, rather than guessing a bar', () => {
    expect(placeFill(bars, '5m', { date: '2026-10-20', time: null }, tokyo)).toEqual({
      kind: 'span',
      from: 3,
      to: 5,
    })
  })

  it('finds the daily bar despite TradingView opening it at 15:00 UTC the day before', () => {
    const daily = [bar(Date.parse('2026-10-18T15:00:00Z')), bar(Date.parse('2026-10-19T15:00:00Z'))]
    expect(placeFill(daily, '1D', { date: '2026-10-20', time: null }, tokyo)).toEqual({
      kind: 'bar',
      index: 1,
    })
    expect(placeFill(daily, '1D', { date: '2026-10-25', time: null }, tokyo)).toBeNull()
  })
})

describe('windowAround', () => {
  const bars = Array.from({ length: 200 }, (_, i) => bar(i * 1000))
  it('keeps the bars before the first fill and after the last', () => {
    const kept = windowAround(bars, 100_500, 150_500, 10, 5)
    expect(kept[0]?.t).toBe(91_000)
    expect(kept[kept.length - 1]?.t).toBe(155_000)
  })
})

describe('yahooRequest', () => {
  const now = Date.parse('2026-10-20T06:00:00Z')

  it('refuses intraday bars Yahoo no longer keeps', () => {
    const old = Date.parse('2026-06-01T00:00:00Z')
    const request = yahooRequest('7203', 'JP_EQUITY', '5m', old, old, now)
    expect(request.ok).toBe(false)
  })

  it('has no four-hour bars to offer', () => {
    expect(yahooRequest('AAPL', 'US_EQUITY', '4h', now, now, now).ok).toBe(false)
  })

  it('asks for daily bars by Yahoo’s symbol and name, ending no later than now', () => {
    const request = yahooRequest('7203', 'JP_EQUITY', '1D', now, now, now)
    expect(request.ok).toBe(true)
    if (!request.ok) return
    const url = new URL(request.url)
    expect(url.pathname).toBe('/v8/finance/chart/7203.T')
    expect(url.searchParams.get('interval')).toBe('1d')
    expect(Number(url.searchParams.get('period2'))).toBe(now / 1000)
  })
})

describe('parseYahooChart', () => {
  it('skips gaps and trims float noise', () => {
    const bars = parseYahooChart({
      chart: {
        result: [
          {
            timestamp: [1, 2],
            indicators: {
              quote: [
                {
                  open: [172.88999938964844, null],
                  high: [173.5, 1],
                  low: [172, 1],
                  close: [173.1, 1],
                  volume: [1000, 1],
                },
              ],
            },
          },
        ],
      },
    })
    expect(bars).toEqual([{ t: 1000, o: '172.89', h: '173.5', l: '172', c: '173.1', v: '1000' }])
  })

  it('returns nothing for an error body', () => {
    expect(parseYahooChart({ chart: { result: null, error: { code: 'Not Found' } } })).toEqual([])
  })
})
