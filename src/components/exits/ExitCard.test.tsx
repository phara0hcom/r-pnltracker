/**
 * What the urgency split promises, pinned.
 *
 * Three claims, each of which looks like a styling detail and is not:
 *
 *  1. The slim card no longer carries the six-level grid. That grid is the
 *     380px the redesign exists to reclaim, and it is one careless re-add away
 *     from coming back.
 *  2. The on-track row is still a `row` with eight `cell`s. The obvious way to
 *     make a whole row clickable is `role="button"` on the `<tr>`, which
 *     silently costs the table its structure for a screen reader — the reason
 *     `OpenPlanButton` is a stretched button instead. Nothing about the
 *     rendered page looks different when that regresses.
 *  3. Both open the plan through a control with a real accessible name.
 */
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ExitCard } from './ExitCard'
import { ExitPlanDialog } from './ExitPlanDialog'
import { ExitPlanRow } from './ExitPlanRow'
import { makePlan } from '~/test/exitPlan'

const ROW = makePlan()

describe('the urgency split', () => {
  it('leaves the card with the recommendation and five facts, not the levels', async () => {
    const onOpen = vi.fn()
    render(<ExitCard row={ROW} onOpen={onOpen} />)

    expect(screen.getByText(ROW.actionMessage)).toBeTruthy()
    expect(screen.getByText('¥-84,000')).toBeTruthy()
    expect(screen.getByText('300 / 300')).toBeTruthy()
    // The six-level grid and the entry facts belong to the dialog now.
    expect(screen.queryByText('Trailing stop')).toBeNull()
    expect(screen.queryByText('Partial size')).toBeNull()

    await userEvent.click(screen.getByRole('button', { name: /Full plan for 7203/ }))
    expect(onOpen).toHaveBeenCalledWith(ROW)
  })

  it('keeps the on-track row a table row, clickable without becoming a button', async () => {
    const onOpen = vi.fn()
    render(
      <table>
        <tbody>
          <ExitPlanRow row={ROW} onOpen={onOpen} />
        </tbody>
      </table>,
    )

    expect(screen.getByRole('row')).toBeTruthy()
    expect(screen.getAllByRole('cell')).toHaveLength(8)
    // Staleness is the flag that has to survive here: the framework still rates
    // a stale plan neutral, so this row is the only place it is announced.
    expect(screen.getByText('Stale 6d')).toBeTruthy()

    await userEvent.click(screen.getByRole('button', { name: /Full plan for 7203/ }))
    expect(onOpen).toHaveBeenCalledWith(ROW)
  })

  it('gives the dialog everything the card gave up, plus edit and archive', () => {
    render(<ExitPlanDialog row={ROW} onClose={vi.fn()} onArchive={vi.fn()} onEdit={vi.fn()} />)

    for (const level of [
      'Current',
      'Effective stop',
      'Target 1',
      'Initial stop',
      'Trailing stop',
      'Partial size',
    ]) {
      expect(screen.getByText(level)).toBeTruthy()
    }
    expect(screen.getByText('63d · 42 sessions')).toBeTruthy()
    expect(screen.getByText(ROW.note ?? '')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Edit plan' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Archive' })).toBeTruthy()
  })
})
