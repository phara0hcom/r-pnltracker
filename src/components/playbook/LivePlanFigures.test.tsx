/**
 * What moved here from the Exit Rules screen when it was removed, pinned, since
 * nothing else would notice a figure going missing: the page still looks whole.
 */
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { LivePlanFigures } from './LivePlanFigures'
import { makePlan } from '~/test/exitPlan'

vi.mock('~/server/playbook', () => ({}))

const figures = (row = makePlan()) =>
  render(<LivePlanFigures row={row} stopMultiple="2" targetMultiple="1.5" target1Manual={false} />)

describe('LivePlanFigures', () => {
  it('carries every level, the entry facts and the note', () => {
    const row = makePlan()
    figures(row)

    for (const label of [
      'Entry',
      'Support',
      'Initial stop',
      'R',
      'Target 1',
      'Effective stop',
      'Trail',
      'Trailing stop',
      'Partial size',
      'Shares',
      'Last close',
      'Unrealized',
      'Held',
    ]) {
      expect(screen.getByText(label)).toBeTruthy()
    }
    expect(screen.getByText('300 / 300')).toBeTruthy()
    expect(screen.getByText('−¥84,000')).toBeTruthy()
    expect(screen.getByText('63d · 42 sessions')).toBeTruthy()
    expect(screen.getByText(row.note ?? '')).toBeTruthy()
  })

  it('says a trail is not active instead of printing a level it does not have', () => {
    figures(makePlan({ trailingStop: null, trailingActive: false }))
    expect(screen.getByText('Not active')).toBeTruthy()
  })

  it('shows RSI and MACD only with a bar to read them from', () => {
    figures(makePlan({ rsi14: null }))
    expect(screen.queryByText('RSI / MACD·h')).toBeNull()
  })

  it('shows when Target 1 was hit, and how it was set', () => {
    figures(makePlan({ target1Hit: true, target1HitDate: '2026-07-01' }))
    expect(screen.getByText('hit 2026-07-01 · auto · 1.5 × R')).toBeTruthy()
    expect(screen.getByText('breakeven or trail')).toBeTruthy()
  })

  it('leaves out a note the plan does not have', () => {
    const { container } = figures(makePlan({ note: null }))
    expect(container.querySelector('p')).toBeNull()
  })
})
