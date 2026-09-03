import { describe, expect, it } from 'vitest'
import { parseFeedBody, repairPineJson, tradingDayFor, zoneFor } from './webhook'

const validBody = JSON.stringify({
  ticker: '7203',
  exchange: 'TSE',
  time: 1_780_272_000_000,
  close: 2847.5,
  sma10: 2800,
  sma20: 2750,
  rsi14: 58.3,
  macd: 12.4,
  macdSignal: 10.1,
  macdHist: 2.3,
  atr14: 45.2,
})

describe('tradingDayFor', () => {
  it('reads a 東証 bar in JST, not UTC', () => {
    // Midnight JST on 1 June 2026 is 15:00 UTC on 31 May. Reading the instant
    // naively would file every JP bar under the previous day.
    const barOpen = Date.parse('2026-05-31T15:00:00Z')
    expect(tradingDayFor(barOpen, 'Asia/Tokyo')).toBe('2026-06-01')
    expect(new Date(barOpen).toISOString().slice(0, 10)).toBe('2026-05-31')
  })

  it('reads a US bar in Eastern time', () => {
    // Midnight EDT on 1 June 2026 is 04:00 UTC the same day.
    expect(tradingDayFor(Date.parse('2026-06-01T04:00:00Z'), 'America/New_York')).toBe('2026-06-01')
  })

  it('keeps a late-evening Eastern instant on its own day', () => {
    expect(tradingDayFor(Date.parse('2026-06-02T03:00:00Z'), 'America/New_York')).toBe('2026-06-01')
  })
})

describe('zoneFor', () => {
  it('maps the venues the tracker can actually hold', () => {
    expect(zoneFor('TSE', 'JP_EQUITY')).toBe('Asia/Tokyo')
    expect(zoneFor('NASDAQ', 'US_EQUITY')).toBe('America/New_York')
    expect(zoneFor('nyse', 'US_EQUITY')).toBe('America/New_York')
  })

  it('falls back to the asset class when the exchange is unknown or absent', () => {
    // The app knows the asset class for certain; the exchange string is whatever
    // TradingView happened to send.
    expect(zoneFor(null, 'JP_EQUITY')).toBe('Asia/Tokyo')
    expect(zoneFor('SOMETHING', 'US_EQUITY')).toBe('America/New_York')
  })
})

describe('repairPineJson', () => {
  it('restores the leading zero Pine drops on values below one', () => {
    // `str.tostring(0.0123, "#.####")` can emit `.0123`, which is not valid JSON
    // — and MACD lines sit near zero constantly.
    expect(repairPineJson('{"macd":.0123}')).toBe('{"macd":0.0123}')
    expect(repairPineJson('{"macd":-.0123}')).toBe('{"macd":-0.0123}')
  })

  it('leaves well-formed numbers alone', () => {
    expect(repairPineJson('{"a":1.5,"b":-2.25}')).toBe('{"a":1.5,"b":-2.25}')
  })

  it('does not reach inside string values', () => {
    // The quote after the colon is what protects these — worth pinning, because
    // a greedier pattern would silently rewrite instrument names.
    expect(repairPineJson('{"name":".5x Fund"}')).toBe('{"name":".5x Fund"}')
  })
})

describe('parseFeedBody', () => {
  it('accepts a well-formed payload and keeps the exact figures', () => {
    const result = parseFeedBody(validBody)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.payload.ticker).toBe('7203')
    // Prices stay as exact text — they land in numeric(24,8) columns.
    expect(result.payload.close).toBe('2847.5')
    expect(result.payload.atr14).toBe('45.2')
  })

  it('accepts numbers sent as strings', () => {
    const result = parseFeedBody(validBody.replace('"close":2847.5', '"close":"2847.5"'))
    expect(result.ok).toBe(true)
  })

  it('recovers a payload Pine emitted without a leading zero', () => {
    const result = parseFeedBody(validBody.replace('"macdHist":2.3', '"macdHist":.0004'))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.payload.macdHist).toBe('0.0004')
  })

  it('rejects a bar whose indicators have not warmed up', () => {
    // `na` serialises as NaN. Storing it as zero would poison the momentum
    // window the time stop reads.
    const result = parseFeedBody(validBody.replace('"rsi14":58.3', '"rsi14":"NaN"'))
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toContain('rsi14')
  })

  it('rejects a body that is not JSON at all', () => {
    const result = parseFeedBody('alert fired')
    expect(result.ok).toBe(false)
  })

  it('names the missing field so a broken alert can be diagnosed', () => {
    const result = parseFeedBody('{"ticker":"7203","time":1780272000000}')
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toContain('close')
  })
})
