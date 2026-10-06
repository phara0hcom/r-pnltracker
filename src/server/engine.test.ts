/**
 * `engineFor` is where both switches reach the trades — the account's for every
 * screen, the market's for Positions — and since the market moved ahead of the
 * engine it is the only place that filter is applied. A version that dropped it
 * would still type-check and every screen would still render, with the other
 * market's holdings in it.
 *
 * The database and the reporter are stubbed; the filtering and the engine are
 * the real ones.
 */
import Decimal from 'decimal.js'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { TradeRecord } from '~/db/trades.service'
import { makeTrade, US_TRADE } from '~/test/trade'

const listTrades = vi.fn<(userId: string) => Promise<TradeRecord[]>>()
vi.mock('~/db/trades.service', () => ({ listTrades: (userId: string) => listTrades(userId) }))
vi.mock('~/lib/observability/report', () => ({ reportWarning: vi.fn() }))

const record = (trade: ReturnType<typeof makeTrade>): TradeRecord => ({
  id: trade.sourceRowHash,
  trade,
  origin: 'IMPORT',
  isEdited: false,
  memo: null,
  motivation: null,
})

const TRADES = [
  makeTrade({ symbol: '7203', accountType: 'SPECIFIC' }),
  makeTrade({ symbol: 'eMAXIS Slim', assetClass: 'FUND', accountType: 'NISA_TSUMITATE', unitPrice: new Decimal('2.5') }),
  makeTrade({ ...US_TRADE, symbol: 'NVDA', accountType: 'SPECIFIC' }),
  makeTrade({ ...US_TRADE, symbol: 'VOO', accountType: 'NISA_GROWTH' }),
]

const held = async (...args: [string, ('ALL' | 'NISA' | 'SPECIFIC')?, ('ALL' | 'JP' | 'US')?]) => {
  const { engineFor } = await import('./engine')
  const result = await engineFor(...args)
  return {
    positions: result.engine.positions.map((position) => position.symbol).sort(),
    trades: result.trades.map((trade) => trade.symbol).sort(),
    unfiltered: result.unfilteredTrades.length,
  }
}

describe('engineFor', () => {
  beforeEach(() => {
    listTrades.mockReset()
    listTrades.mockResolvedValue(TRADES.map(record))
  })

  it('runs over everything by default', async () => {
    expect((await held('u1')).positions).toEqual(['7203', 'NVDA', 'VOO', 'eMAXIS Slim'])
    expect(listTrades).toHaveBeenCalledWith('u1')
  })

  it('runs the engine over one market only — funds counting as JP', async () => {
    expect(await held('u1', 'ALL', 'US')).toEqual({ positions: ['NVDA', 'VOO'], trades: ['NVDA', 'VOO'], unfiltered: 4 })
    expect((await held('u1', 'ALL', 'JP')).positions).toEqual(['7203', 'eMAXIS Slim'])
  })

  it('applies the account and the market together', async () => {
    expect((await held('u1', 'NISA', 'US')).positions).toEqual(['VOO'])
    expect((await held('u1', 'SPECIFIC', 'JP')).positions).toEqual(['7203'])
    expect((await held('u1', 'NISA', 'ALL')).positions).toEqual(['VOO', 'eMAXIS Slim'])
  })

  it('still hands back every trade for the lookups that must see across the switches', async () => {
    expect((await held('u1', 'SPECIFIC', 'US')).unfiltered).toBe(TRADES.length)
  })
})
