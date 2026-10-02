import { describe, expect, it } from 'vitest'
import { quotedPrice, storedPrice } from './quoteUnit'

describe('fund price units', () => {
  it('stores a 基準価額 per single 口', () => {
    expect(storedPrice('31240', 'FUND').toFixed()).toBe('3.124')
  })

  it('shows a stored fund price per 10,000 口', () => {
    // As `numeric(24,8)` hands it back.
    expect(quotedPrice('3.12400000', 'FUND').toFixed()).toBe('31240')
  })

  it('round-trips a price with a fraction of a yen', () => {
    expect(quotedPrice(storedPrice('44820.5', 'FUND'), 'FUND').toFixed()).toBe('44820.5')
  })

  it('leaves shares and US stock alone', () => {
    expect(storedPrice('2048.5', 'JP_EQUITY').toFixed()).toBe('2048.5')
    expect(quotedPrice('234.1', 'US_EQUITY').toFixed()).toBe('234.1')
  })
})
