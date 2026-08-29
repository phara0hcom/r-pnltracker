/**
 * The rule under test is the locked one: a table must not be configurable into
 * a state where its rows cannot be identified, or into no columns at all.
 */
import { describe, expect, it } from 'vitest'
import { hiddenCount, isHideable, toggleColumn, visibleColumns, type TableColumn } from './columns'

type Key = 'symbol' | 'side' | 'qty' | 'fee'

const columns: TableColumn<Key>[] = [
  { key: 'symbol', label: 'Instrument', locked: true },
  { key: 'side', label: 'Side', locked: true },
  { key: 'qty', label: 'Qty' },
  { key: 'fee', label: 'Fee' },
]

describe('visibleColumns', () => {
  it('shows everything when nothing is hidden', () => {
    expect(visibleColumns(columns, [])).toEqual(['symbol', 'side', 'qty', 'fee'])
  })

  it('drops a hidden column', () => {
    expect(visibleColumns(columns, ['fee'])).toEqual(['symbol', 'side', 'qty'])
  })

  it('keeps a locked column visible even when it is in the hidden set', () => {
    // A stale stored preference, or a column that became locked after it was
    // hidden. Either way the lock wins.
    expect(visibleColumns(columns, ['symbol', 'side', 'qty', 'fee'])).toEqual(['symbol', 'side'])
  })

  it('renders in declaration order, not the order columns were re-shown', () => {
    // Hiding Qty and bringing it back must put it between Side and Fee again.
    expect(visibleColumns(columns, ['qty'])).toEqual(['symbol', 'side', 'fee'])
    expect(visibleColumns(columns, [])).toEqual(['symbol', 'side', 'qty', 'fee'])
  })

  it('ignores a stored key that no longer names a column', () => {
    expect(visibleColumns(columns, ['removedLastYear'])).toHaveLength(4)
  })

  it('never renders zero columns, even with nothing locked', () => {
    const unlocked: TableColumn<Key>[] = [
      { key: 'qty', label: 'Qty' },
      { key: 'fee', label: 'Fee' },
    ]
    expect(visibleColumns(unlocked, ['qty', 'fee'])).toEqual(['qty'])
  })
})

describe('toggleColumn', () => {
  it('hides a shown column and shows a hidden one', () => {
    expect(toggleColumn(columns, [], 'fee')).toEqual(['fee'])
    expect(toggleColumn(columns, ['fee'], 'fee')).toEqual([])
  })

  it('refuses to hide a locked column', () => {
    const hidden = ['fee']
    expect(toggleColumn(columns, hidden, 'symbol')).toBe(hidden)
  })

  it('refuses an unknown key rather than storing it', () => {
    const hidden: string[] = []
    expect(toggleColumn(columns, hidden, 'nope')).toBe(hidden)
  })
})

describe('isHideable', () => {
  it('separates locked from ordinary columns', () => {
    expect(isHideable(columns, 'qty')).toBe(true)
    expect(isHideable(columns, 'symbol')).toBe(false)
    expect(isHideable(columns, 'unknown')).toBe(false)
  })
})

describe('hiddenCount', () => {
  it('counts only columns the user could actually hide', () => {
    // A locked key in the stored set must not inflate the badge.
    expect(hiddenCount(columns, ['fee', 'symbol'])).toBe(1)
    expect(hiddenCount(columns, [])).toBe(0)
  })
})

describe('redundant columns', () => {
  it('hides a column a filter has pinned to one value', () => {
    // Filtering to sells makes Side the same word on every row.
    expect(visibleColumns(columns, [], ['side'])).toEqual(['symbol', 'qty', 'fee'])
  })

  it('beats the lock, since the filter guarantees what the lock protects', () => {
    // Side is locked so a buy and a sell stay distinguishable — which is
    // precisely what `side=SELL` has already settled.
    expect(visibleColumns(columns, [], ['side'])).not.toContain('side')
  })

  it('leaves the stored preference untouched when the filter clears', () => {
    // The column comes back to whatever the user had chosen, not to shown.
    expect(visibleColumns(columns, ['fee'], ['fee'])).toEqual(['symbol', 'side', 'qty'])
    expect(visibleColumns(columns, ['fee'], [])).toEqual(['symbol', 'side', 'qty'])
    expect(visibleColumns(columns, [], [])).toEqual(['symbol', 'side', 'qty', 'fee'])
  })

  it('is not counted as something the user hid', () => {
    // The badge points at menu entries, and a pinned column is not offered.
    expect(hiddenCount(columns, ['fee'], ['fee'])).toBe(0)
    expect(hiddenCount(columns, ['fee'], [])).toBe(1)
  })
})
