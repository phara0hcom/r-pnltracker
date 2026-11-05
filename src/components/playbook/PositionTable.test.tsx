/**
 * Staleness is the flag that has to survive in the list. The framework rates a
 * stale plan neutral, so it never reaches Needs action, and a lapsed alert is the
 * failure this feature is most likely to suffer: this badge is all that says so.
 */
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router'
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { PositionTable } from './PositionTable'
import type { PositionRow } from '~/server/playbook'
import { makePlan } from '~/test/exitPlan'

const mobile = vi.hoisted(() => ({ value: false }))
vi.mock('~/components/ui/useIsMobile', () => ({ useIsMobile: () => mobile.value }))

const ROW: PositionRow = {
  id: 'j1',
  kind: 'REAL',
  symbol: '7203',
  name: 'トヨタ自動車',
  assetClass: 'JP_EQUITY',
  accountType: 'SPECIFIC',
  currency: 'JPY',
  setupId: null,
  setupName: null,
  status: 'OPEN',
  openDate: '2026-06-03',
  closeDate: null,
  result: null,
  resultJpy: null,
  returnPct: null,
  r: null,
  entryScore: null,
  exitScore: null,
  riskScore: null,
  overall: null,
  provisional: false,
  plan: makePlan({ actionSeverity: 'neutral' }),
  linkable: false,
}

function table() {
  const rootRoute = createRootRoute({
    component: () => <PositionTable rows={[ROW]} kind="REAL" sortBy={undefined} sortDir="desc" onSort={vi.fn()} onLink={vi.fn()} />,
  })
  rootRoute.addChildren([createRoute({ getParentRoute: () => rootRoute, path: '/playbook/$journalId' })])
  const router = createRouter({ routeTree: rootRoute, history: createMemoryHistory({ initialEntries: ['/'] }) })
  return render(<RouterProvider router={router} />)
}

describe('PositionTable', () => {
  it.each([
    ['the desktop table', false],
    ['a phone card', true],
  ])('flags a stale plan rated neutral on %s', async (_, isMobile) => {
    mobile.value = isMobile
    table()
    expect(await screen.findByText('Stale 6d')).toBeTruthy()
  })
})
