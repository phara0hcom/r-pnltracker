/**
 * Two rules carry the weight here, and both come from real columns:
 *
 * - money arrives as decimal *strings*, so a lexical compare puts "9" above
 *   "10" and quietly reorders the whole table;
 * - an unpriced position is unmeasured, not worthless, so it belongs at the
 *   bottom whichever way the arrow points.
 */
import { describe, expect, it } from 'vitest'
import { nextSort, sortRows, type SortColumn } from './sortRows'

interface Row {
  symbol: string
  costBasisJpy: string
  unrealizedJpy: string | null
}

const columns: Record<'symbol' | 'costBasisJpy' | 'unrealizedJpy', SortColumn<Row>> = {
  symbol: { value: (row) => row.symbol },
  costBasisJpy: { value: (row) => row.costBasisJpy, numeric: true },
  unrealizedJpy: { value: (row) => row.unrealizedJpy, numeric: true },
}

const rows: Row[] = [
  { symbol: 'SONY', costBasisJpy: '9', unrealizedJpy: '-500' },
  { symbol: 'AAPL', costBasisJpy: '10', unrealizedJpy: null },
  { symbol: 'TOYOTA', costBasisJpy: '100', unrealizedJpy: '20' },
]

const symbols = (list: Row[]) => list.map((row) => row.symbol)

describe('sortRows', () => {
  it('compares decimal strings numerically, not lexically', () => {
    expect(symbols(sortRows(rows, columns, 'costBasisJpy', 'asc'))).toEqual([
      'SONY',
      'AAPL',
      'TOYOTA',
    ])
    expect(symbols(sortRows(rows, columns, 'costBasisJpy', 'desc'))).toEqual([
      'TOYOTA',
      'AAPL',
      'SONY',
    ])
  })

  it('sorts text columns lexically in both directions', () => {
    expect(symbols(sortRows(rows, columns, 'symbol', 'asc'))).toEqual(['AAPL', 'SONY', 'TOYOTA'])
    expect(symbols(sortRows(rows, columns, 'symbol', 'desc'))).toEqual(['TOYOTA', 'SONY', 'AAPL'])
  })

  it('keeps unknown values last regardless of direction', () => {
    expect(symbols(sortRows(rows, columns, 'unrealizedJpy', 'asc')).at(-1)).toBe('AAPL')
    expect(symbols(sortRows(rows, columns, 'unrealizedJpy', 'desc')).at(-1)).toBe('AAPL')
  })

  it('does not mutate the input', () => {
    const original = [...rows]
    sortRows(rows, columns, 'costBasisJpy', 'asc')
    expect(rows).toEqual(original)
  })

  it('treats two unknowns as equal rather than reordering them', () => {
    const blanks: Row[] = [
      { symbol: 'B', costBasisJpy: '1', unrealizedJpy: null },
      { symbol: 'A', costBasisJpy: '2', unrealizedJpy: null },
    ]
    expect(symbols(sortRows(blanks, columns, 'unrealizedJpy', 'asc'))).toEqual(['B', 'A'])
  })
})

describe('nextSort', () => {
  it('starts a new column descending', () => {
    expect(nextSort('symbol', 'costBasisJpy', 'asc')).toEqual({
      sortBy: 'symbol',
      sortDir: 'desc',
    })
  })

  it('flips the active column and cycles back', () => {
    expect(nextSort('symbol', 'symbol', 'desc')).toEqual({ sortBy: 'symbol', sortDir: 'asc' })
    expect(nextSort('symbol', 'symbol', 'asc')).toEqual({ sortBy: 'symbol', sortDir: 'desc' })
  })
})
