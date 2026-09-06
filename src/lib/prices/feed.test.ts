import { describe, expect, it } from 'vitest'
import { feedCurrencyFor } from './feed'

describe('feedCurrencyFor', () => {
  it('quotes each equity market in its own currency', () => {
    expect(feedCurrencyFor('JP_EQUITY')).toBe('JPY')
    expect(feedCurrencyFor('US_EQUITY')).toBe('USD')
  })

  it('refuses funds, whose price is not on the same scale as a bar close', () => {
    // 基準価額 is quoted per 10,000 口 and divided down at parse time. A raw
    // close published against a fund would be wrong by four orders of
    // magnitude — silently, and in the direction that flatters the portfolio.
    expect(feedCurrencyFor('FUND')).toBeNull()
  })
})
