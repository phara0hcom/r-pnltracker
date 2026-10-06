/**
 * The switch behind both the account and the market filter.
 *
 * Two things a refactor could quietly lose: the hint is visible text — a
 * tooltip alone never shows on a phone — and pressing the active choice again,
 * which Radix reports as '', must not leave the screen with no filter at all.
 */
import { fireEvent, render, screen } from '@testing-library/react'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { FilterSwitch } from './FilterSwitch'

const OPTIONS = [
  { value: 'ALL', label: 'All' },
  { value: 'JP', label: 'JP' },
  { value: 'US', label: 'US' },
] as const

const HINTS = { ALL: 'Both', JP: 'Yen side', US: 'Dollar side' }

describe('FilterSwitch', () => {
  beforeAll(() => {
    const list = { matches: false, addEventListener: () => undefined, removeEventListener: () => undefined }
    vi.stubGlobal('matchMedia', () => list)
  })

  afterAll(() => {
    vi.unstubAllGlobals()
  })

  it('says what the current choice covers, as text on the page', () => {
    render(<FilterSwitch label="Filter by market" options={OPTIONS} hints={HINTS} value="US" onChange={vi.fn()} />)
    expect(screen.getByText('Dollar side')).toBeTruthy()
    expect(screen.getByRole('radiogroup', { name: 'Filter by market' })).toBeTruthy()
  })

  it('reports a new choice', () => {
    const onChange = vi.fn()
    render(<FilterSwitch label="Filter by market" options={OPTIONS} hints={HINTS} value="ALL" onChange={onChange} />)
    fireEvent.click(screen.getByRole('radio', { name: 'JP' }))
    expect(onChange).toHaveBeenCalledWith('JP')
  })

  it('ignores a press on the active choice rather than clearing the filter', () => {
    const onChange = vi.fn()
    render(<FilterSwitch label="Filter by market" options={OPTIONS} hints={HINTS} value="JP" onChange={onChange} />)
    fireEvent.click(screen.getByRole('radio', { name: 'JP' }))
    expect(onChange).not.toHaveBeenCalled()
  })
})
