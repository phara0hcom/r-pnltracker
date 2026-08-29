/**
 * The rules that carry the weight here all come from the real exports:
 *
 * - fund names are free text and contain commas, so quoting is not optional;
 * - an unpriced position must export as empty cells, never as zero;
 * - Excel needs the BOM or every Japanese name arrives as mojibake.
 */
import { describe, expect, it } from 'vitest'
import { todayLocal } from '../localDate'
import { positionsCsv, positionsCsvFilename, type PositionCsvRow } from './positionsCsv'

const labels = {
  account: { SPECIFIC: '特定', NISA_GROWTH: 'NISA 成長' },
  assetClass: { JP_EQUITY: 'JP equity', US_EQUITY: 'US equity', FUND: 'Fund' },
}

const row = (over: Partial<PositionCsvRow> = {}): PositionCsvRow => ({
  symbol: '8411',
  name: 'みずほフィナンシャルグループ',
  assetClass: 'JP_EQUITY',
  accountType: 'SPECIFIC',
  currency: 'JPY',
  quantity: '300',
  avgPriceNative: '2510.0000',
  avgCostPerUnit: '2510.0000',
  avgFxRate: '1.00',
  costBasisJpy: '753000',
  currentPrice: '3120',
  marketValueJpy: '936000',
  unrealizedJpy: '183000',
  unrealizedPct: 0.243027,
  priceAsOf: '2026-08-29T04:12:00.000Z',
  priceSource: 'KABUTAN',
  ...over,
})

/** The file minus its BOM, split into lines — what a parser would actually see. */
const lines = (csv: string) => csv.slice(1).trimEnd().split('\r\n')

describe('positionsCsv', () => {
  it('starts with a UTF-8 BOM so Excel does not mojibake the Japanese names', () => {
    expect(positionsCsv([row()], labels).startsWith('﻿')).toBe(true)
  })

  it('writes a header row followed by one row per position', () => {
    const output = lines(positionsCsv([row(), row({ symbol: '7203' })], labels))
    expect(output).toHaveLength(3)
    expect(output[0]).toMatch(/^Symbol,Name,Class,Account,Currency,Quantity,/)
    expect(output[1]).toMatch(/^8411,/)
    expect(output[2]).toMatch(/^7203,/)
  })

  it('quotes a fund name containing a comma rather than shifting every later column', () => {
    // Real instrument names from the Rakuten exports look exactly like this.
    const csv = positionsCsv(
      [row({ name: 'eMAXIS Slim 米国株式(S&P500), 為替ヘッジなし', assetClass: 'FUND' })],
      labels,
    )
    const [, first = ''] = lines(csv)
    expect(first).toContain('"eMAXIS Slim 米国株式(S&P500), 為替ヘッジなし"')
    // Header and body must still agree on column count.
    expect(first.split(',')).toHaveLength(17)
  })

  it('doubles an embedded quote, per RFC 4180', () => {
    const [, first = ''] = lines(positionsCsv([row({ name: 'iShares "Core" ETF' })], labels))
    expect(first).toContain('"iShares ""Core"" ETF"')
  })

  it('leaves an unpriced position blank rather than exporting it as zero', () => {
    const csv = positionsCsv(
      [
        row({
          currentPrice: null,
          marketValueJpy: null,
          unrealizedJpy: null,
          unrealizedPct: null,
          priceAsOf: null,
          priceSource: null,
        }),
      ],
      labels,
    )
    const [, first = ''] = lines(csv)
    expect(first.endsWith(',,,,,,')).toBe(true)
  })

  it('writes exact decimal strings, not display-formatted yen', () => {
    const [, first = ''] = lines(positionsCsv([row()], labels))
    expect(first).toContain('753000')
    expect(first).not.toContain('¥')
    expect(first).not.toContain('753,000')
  })

  it('writes the percentage as a ratio a spreadsheet can format', () => {
    const [, first = ''] = lines(positionsCsv([row({ unrealizedPct: 0.1 + 0.2 })], labels))
    // 0.30000000000000004 must not reach the file.
    expect(first).toContain('0.300000')
  })

  it('maps the enum columns through the labels it is given', () => {
    const [, first = ''] = lines(positionsCsv([row({ accountType: 'NISA_GROWTH' })], labels))
    expect(first).toContain('JP equity')
    expect(first).toContain('NISA 成長')
  })

  it('falls back to the raw enum when a label is missing', () => {
    const [, first = ''] = lines(positionsCsv([row({ accountType: 'NISA_OLD' })], labels))
    expect(first).toContain('NISA_OLD')
  })

  it('emits a header-only file for an empty portfolio', () => {
    expect(lines(positionsCsv([], labels))).toHaveLength(1)
  })

  it('preserves the order it is given, since that is the order on screen', () => {
    const output = lines(
      positionsCsv([row({ symbol: 'AAPL' }), row({ symbol: '8411' })], labels),
    )
    expect(output[1]?.startsWith('AAPL')).toBe(true)
    expect(output[2]?.startsWith('8411')).toBe(true)
  })
})

describe('positionsCsvFilename', () => {
  it('names an unfiltered export by date alone', () => {
    expect(positionsCsvFilename('ALL', '2026-08-29')).toBe('positions-2026-08-29.csv')
  })

  it('carries the scope so two exports on one day do not collide', () => {
    expect(positionsCsvFilename('NISA', '2026-08-29')).toBe('positions-nisa-2026-08-29.csv')
    expect(positionsCsvFilename('SPECIFIC', '2026-08-29')).toBe('positions-specific-2026-08-29.csv')
  })

  it('defaults to the local calendar date, not the UTC one', () => {
    // The regression this guards is someone reaching for `toISOString()`, which
    // for JST names the file with yesterday's date every morning before 09:00.
    expect(positionsCsvFilename('ALL')).toBe(`positions-${todayLocal()}.csv`)
  })
})
