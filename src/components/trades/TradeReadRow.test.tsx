/**
 * A US close leads with dollars.
 *
 * The regression this pins is the one that prompted it: a SOXL sell above its
 * average dollar cost rendered as a red yen loss, because the only realized
 * figure was the tax one — every trade at its own day's rate — and the yen had
 * weakened between the buys and the sells.
 */
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { TradeReadRow } from './TradeReadRow'
import type { TradeRow } from '~/server/trades'

const EVERY_COLUMN = new Set(['symbol', 'fee', 'realized', 'returnPct'])

const soxlSell: TradeRow = {
  id: 't1',
  tradeDate: '2026-09-24',
  settleDate: '2026-09-28',
  symbol: 'SOXL',
  name: 'DRX SEMICONDUCTOR BULL 3X',
  assetClass: 'US_EQUITY',
  accountType: 'SPECIFIC',
  side: 'SELL',
  quantity: '20',
  displayPrice: '146.0497',
  fee: '13.23',
  feeTax: '1.31',
  commission: '14.54',
  fxRate: '155.47',
  currency: 'USD',
  netAmountJpy: '451866',
  realizedJpy: '-3246',
  costJpy: '455112',
  realizedUsd: '60.94',
  costUsd: '2860.05',
  netUsd: '46.42',
  returnPct: 0.0162,
  isSettled: true,
  origin: 'IMPORT',
  isEdited: false,
  memo: null,
}

function renderRow(row: TradeRow) {
  render(
    <table>
      <tbody>
        <TradeReadRow
          row={row}
          visible={EVERY_COLUMN}
          onReveal={() => undefined}
          onEdit={() => undefined}
          onDelete={() => undefined}
          deleting={false}
        />
      </tbody>
    </table>,
  )
}

describe('realized cell', () => {
  it('shows a US close in dollars, with its yen in brackets as Rakuten does', () => {
    renderRow(soxlSell)
    const cell = screen.getByText('$60.94')
    expect(cell.textContent).toBe('$60.94(¥-3,246)')
  })

  it('explains both figures in the hover text', () => {
    renderRow(soxlSell)
    const title = screen.getByText('$60.94').getAttribute('title') ?? ''
    expect(title).toContain('$46.42 after the sell commission as well')
    expect(title).toContain('¥-3,246 in yen, the currency move included')
  })

  it('leaves a yen close as it was', () => {
    renderRow({
      ...soxlSell,
      symbol: '8411',
      assetClass: 'JP_EQUITY',
      currency: 'JPY',
      fee: '0',
      realizedJpy: '12500',
      realizedUsd: null,
      costUsd: null,
      netUsd: null,
    })
    expect(screen.getByText('¥12,500').hasAttribute('title')).toBe(false)
  })
})
