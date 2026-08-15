import { describe, expect, it } from 'vitest'
import { hasQuotableTicker } from './providers'

describe('hasQuotableTicker', () => {
  it('accepts 東証 four-digit codes', () => {
    expect(hasQuotableTicker('8411', 'JP_EQUITY')).toBe(true)
    // ETFs are ordinary listed codes, not a special case.
    expect(hasQuotableTicker('1459', 'JP_EQUITY')).toBe(true)
  })

  it('accepts the alphanumeric codes issued since 2024', () => {
    expect(hasQuotableTicker('130A', 'JP_EQUITY')).toBe(true)
  })

  it('rejects funds outright, whatever they are named', () => {
    // The blocker is structural: Rakuten's exports carry no fund code, and no
    // free source resolves 基準価額 from a fund's name.
    expect(hasQuotableTicker('eMAXIS Slim 米国株式(S&P500)', 'FUND')).toBe(false)
    expect(hasQuotableTicker('楽天・プラス・日経225インデックス・ファンド', 'FUND')).toBe(false)
    // Even a fund whose name happens to look like a code stays excluded.
    expect(hasQuotableTicker('1234', 'FUND')).toBe(false)
  })

  it('rejects a JP name that is not a listing code', () => {
    expect(hasQuotableTicker('日経225', 'JP_EQUITY')).toBe(false)
    expect(hasQuotableTicker('', 'JP_EQUITY')).toBe(false)
    expect(hasQuotableTicker('84115', 'JP_EQUITY')).toBe(false)
  })

  it('accepts US tickers including a share class', () => {
    expect(hasQuotableTicker('AAPL', 'US_EQUITY')).toBe(true)
    expect(hasQuotableTicker('BRK B', 'US_EQUITY')).toBe(true)
    expect(hasQuotableTicker('KO', 'US_EQUITY')).toBe(true)
  })

  it('rejects a US company display name', () => {
    // The statement parser can mint instruments keyed by name; those must never
    // reach a provider.
    expect(hasQuotableTicker('ADVANCED M D INC', 'US_EQUITY')).toBe(false)
  })
})
