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
import type { ExitRuleRow } from '~/server/exit'

const ROW: ExitRuleRow = {
  id: 'r1',
  symbol: '7203',
  name: 'トヨタ自動車',
  assetClass: 'JP_EQUITY',
  accountType: 'SPECIFIC',
  currency: 'JPY',
  entryDate: '2026-06-03',
  entryPrice: '2996',
  totalShares: '300',
  sharesRemaining: '300',
  supportLevel: '2700',
  entryAtr: '95',
  lotSize: 100,
  trailingMethod: 'ATR',
  trailingMethodOverride: null,
  note: 'Support at ¥2,700 from the June base.',
  initialStop: '2710',
  riskPerShare: '286',
  target1: '3180',
  partialExitShares: '200',
  target1Hit: false,
  target1HitDate: null,
  partialTaken: false,
  highestClose: '3050',
  trailingStop: null,
  trailingActive: false,
  currentStop: '2710',
  currentPrice: '2684',
  lastBarDate: '2026-09-04',
  rsi14: '31.4',
  macdHist: '-18.2',
  atr14: '88',
  daysHeld: 63,
  tradingDaysHeld: 42,
  timeStopFlag: false,
  stale: true,
  staleTradingDays: 6,
  stopFromSupportOnly: false,
  unrealizedPerShare: '-280',
  unrealizedTotal: '-84000',
  actionKind: 'STOPPED_OUT',
  actionMessage: 'Stopped out — close ¥2,684 is at or below the ¥2,710 stop.',
  actionSeverity: 'urgent',
}

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
