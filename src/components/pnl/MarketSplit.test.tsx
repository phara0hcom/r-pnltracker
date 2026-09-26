/**
 * The split reads the way Rakuten's app does: the JPY account in yen, the USD
 * account in dollars with its yen in brackets. Figures are September 2026's.
 */
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { MarketBreakdown, MarketInline } from './MarketSplit'
import type { MarketSplitView } from '~/lib/pnl/markets'

const september: MarketSplitView = {
  jpyRealizedJpy: '110207',
  usdRealizedUsd: '-818.86',
  usdRealizedJpy: '-207087',
  totalJpy: '-96880',
}

describe('MarketBreakdown', () => {
  it('gives each account in its own currency', () => {
    render(<MarketBreakdown split={september} currencyEffectJpy="-61000" />)
    expect(screen.getByText('JPY account').nextElementSibling?.textContent).toBe('+¥110,207')
    expect(screen.getByText('USD account').nextElementSibling?.textContent).toBe('$-818.86(¥-207,087)')
    expect(screen.getByText(/from the exchange rate/).textContent).toContain('¥-61,000')
  })

  it('marks an account with no closes rather than showing zero', () => {
    render(<MarketBreakdown split={{ ...september, usdRealizedUsd: null, usdRealizedJpy: null }} currencyEffectJpy="-61000" />)
    expect(screen.getByText('USD account').nextElementSibling?.textContent).toBe('—')
    // Nothing closed in dollars, so there is no currency effect to explain.
    expect(screen.queryByText(/from the exchange rate/)).toBeNull()
  })
})

describe('MarketInline', () => {
  it('puts both accounts on one line', () => {
    const { container } = render(<MarketInline split={september} />)
    expect(container.textContent).toBe('JPY +¥110,207·USD $-818.86(¥-207,087)')
  })

  it('leaves out a side with no closes, and renders nothing with neither', () => {
    const { container } = render(<MarketInline split={{ ...september, jpyRealizedJpy: null }} />)
    expect(container.textContent).toBe('USD $-818.86(¥-207,087)')
    const empty = render(
      <MarketInline split={{ jpyRealizedJpy: null, usdRealizedUsd: null, usdRealizedJpy: null, totalJpy: '0' }} />,
    )
    expect(empty.container.textContent).toBe('')
  })
})
