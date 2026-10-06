/**
 * The Positions screen's blocks, as the page renders them.
 *
 * `getPositions` is stubbed with what the server builds minus the database and
 * the engine: the same scope test the engine's input goes through, and the real
 * `splitFor` and `summarizePositions` over hand-written rows. The stub answers
 * whatever filters the route actually asked for, so a route that sent the wrong
 * ones would render the wrong book. What is pinned is the screen's side: which
 * headings appear under each pairing of the filters, and which rows under each.
 *
 * Lives here, not beside the route: the router's file generator treats every
 * file under `src/routes` as a route.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { matchesAccountFilter, matchesMarketFilter } from '~/lib/domain/types'
import { positionsInput } from '~/lib/marketScope'
import { splitFor, summarizePositions } from '~/lib/pnl/positionSummary'
import type { PositionRow, PositionsData } from '~/server/screens'

const row = (symbol: string, over: Partial<PositionRow>): PositionRow =>
  ({
    symbol,
    name: symbol,
    assetClass: 'JP_EQUITY',
    accountType: 'SPECIFIC',
    quantity: '100',
    costBasisJpy: '100000',
    avgCostPerUnit: '1000',
    avgPriceNative: '1000',
    avgFxRate: '1',
    currency: 'JPY',
    currentPrice: '1100',
    priceAsOf: null,
    priceSource: 'TEST',
    avgPriceQuoted: '1000.0',
    priceQuoted: '1100.0',
    costShownJpy: '100000',
    marketValueJpy: '110000',
    unrealizedJpy: '10000',
    unrealizedPct: 0.1,
    weight: null,
    costUsd: null,
    marketValueUsd: null,
    unrealizedUsd: null,
    unrealizedTaxJpy: null,
    usdJpy: null,
    ...over,
  })

const US = { assetClass: 'US_EQUITY', currency: 'USD', usdJpy: '150' } as const

const BOOK: PositionRow[] = [
  row('7203', { accountType: 'SPECIFIC' }),
  row('8306', { accountType: 'NISA_GROWTH', marketValueJpy: '300000', costShownJpy: '200000' }),
  row('NVDA', { ...US, accountType: 'SPECIFIC', marketValueJpy: '500000', costShownJpy: '400000' }),
  row('VOO', { ...US, accountType: 'NISA_GROWTH', marketValueJpy: '200000', costShownJpy: '150000' }),
]

/** What `getPositions` returns for a filter pairing, minus the database. */
function serve(input: { account?: string; market?: string }, book = BOOK): PositionsData {
  const filters = positionsInput(input)
  // `engineFor` applies both filters to the trades; a row stands in for its pool.
  const rows = book.filter(
    (entry) =>
      matchesAccountFilter(entry.accountType, filters.account) &&
      matchesMarketFilter(entry.assetClass, filters.market),
  )
  const summary = summarizePositions(rows, splitFor(rows, filters))
  return {
    rows: rows.map((entry, index) => ({ ...entry, weight: summary.weights[index] ?? null })),
    total: summary.total,
    accounts: summary.accounts,
    groups: summary.groups,
    classes: summary.classes,
    highlights: summary.highlights,
    usdJpy: rows.some((entry) => entry.usdJpy != null) ? '150' : null,
  }
}

interface Request { data: { account?: string; market?: string } }

const getPositions = vi.fn<(request: Request) => Promise<PositionsData>>()
vi.mock('~/server/screens', () => ({ getPositions: (request: Request) => getPositions(request) }))

/** Serve `book` for whatever filters the route asks for. */
const serving = (book = BOOK) => {
  getPositions.mockImplementation(({ data }) => Promise.resolve(serve(data, book)))
}

async function renderAt(search: string) {
  const { Route } = await import('~/routes/_authed/positions')
  const root = createRootRoute()
  const positions = Route.update({
    id: '/_authed/positions',
    path: '/positions',
    getParentRoute: () => root,
  } as never)
  root.addChildren([positions])
  const router = createRouter({
    routeTree: root,
    history: createMemoryHistory({ initialEntries: [`/positions${search}`] }),
  })
  render(
    <QueryClientProvider client={new QueryClient()}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )
  return router
}

/** Each block's heading (without its count) and the symbols listed under it. */
const blocks = () =>
  screen
    .getAllByRole('rowgroup')
    .filter((element) => element.tagName === 'TBODY')
    .map((body) => {
      const rows = within(body).getAllByRole('row')
      const heading = rows.find((tr) => tr.querySelector('th[scope="rowgroup"]'))
      return {
        heading: heading?.querySelector('th')?.textContent?.replace(/\d+ positions?$/, '').trim() ?? null,
        symbols: rows
          .filter((tr) => tr !== heading)
          .map((tr) => BOOK.find((entry) => tr.textContent?.includes(entry.symbol))?.symbol),
      }
    })

let mobile = false

describe('Positions blocks', () => {
  beforeAll(() => {
    // jsdom has no matchMedia. One object, read live, so a test can flip it
    // between renders — `useIsMobile` caches the list but reads `matches` each time.
    const list = {
      get matches() {
        return mobile
      },
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }
    vi.stubGlobal('matchMedia', () => list)
    // `PageHeader` watches its title scroll under the bar.
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        observe = () => undefined
        disconnect = () => undefined
      },
    )
  })

  afterAll(() => {
    vi.unstubAllGlobals()
  })

  beforeEach(() => {
    // `mockReset`, not `mockClear`: a test that serves a different book must
    // not leave it behind for the next.
    getPositions.mockReset()
    serving()
    mobile = false
  })

  it('splits by market and account when neither filter is narrowed', async () => {
    await renderAt('')
    await screen.findByRole('table')
    // Markets in a fixed order, accounts largest-first and the same under each.
    expect(blocks()).toEqual([
      { heading: 'JP stocks & funds · 特定口座', symbols: ['7203'] },
      { heading: 'JP stocks & funds · NISA 成長投資枠', symbols: ['8306'] },
      { heading: 'US stocks · 特定口座', symbols: ['NVDA'] },
      { heading: 'US stocks · NISA 成長投資枠', symbols: ['VOO'] },
    ])
    expect(getPositions).toHaveBeenCalledWith({ data: { account: 'ALL', market: 'ALL' } })
    expect(screen.getByRole('table').querySelector('caption')?.textContent).toMatch(/^Positions by market and account,/)
  })

  it('splits by market alone under 特定', async () => {
    await renderAt('?scope=SPECIFIC')
    await screen.findByRole('table')
    expect(blocks()).toEqual([
      { heading: 'JP stocks & funds', symbols: ['7203'] },
      { heading: 'US stocks', symbols: ['NVDA'] },
    ])
  })

  it('splits by account alone under one market', async () => {
    await renderAt('?market=US')
    await screen.findByRole('table')
    expect(blocks()).toEqual([
      { heading: '特定口座', symbols: ['NVDA'] },
      { heading: 'NISA 成長投資枠', symbols: ['VOO'] },
    ])
    expect(getPositions).toHaveBeenCalledWith({ data: { account: 'ALL', market: 'US' } })
  })

  it('shows one list with no heading when both filters are narrowed', async () => {
    await renderAt('?scope=SPECIFIC&market=JP')
    await screen.findByRole('table')
    expect(blocks()).toEqual([{ heading: null, symbols: ['7203'] }])
    expect(screen.getByRole('table').querySelector('caption')?.textContent).toMatch(/^Positions, sorted by/)
  })

  it('puts no market heading over a book that holds one market', async () => {
    serving(BOOK.filter((entry) => entry.assetClass !== 'US_EQUITY'))
    await renderAt('')
    await screen.findByRole('table')
    expect(blocks()).toEqual([
      { heading: 'NISA 成長投資枠', symbols: ['8306'] },
      { heading: '特定口座', symbols: ['7203'] },
    ])
  })

  it('cuts the phone card list into the same blocks', async () => {
    mobile = true
    await renderAt('')
    await screen.findByRole('region', { name: 'JP stocks & funds, 特定口座' })
    expect(screen.getByRole('region', { name: 'US stocks, NISA 成長投資枠' })).toBeTruthy()
    expect(screen.queryByRole('table')).toBeNull()
  })

  it('refetches for the market chosen, and writes it to the URL', async () => {
    const router = await renderAt('')
    await screen.findByRole('table')
    fireEvent.click(screen.getByRole('radio', { name: 'US' }))
    // Waits for the US book itself — its headings name accounts alone — rather
    // than for a row that was already on screen before the click.
    await waitFor(() => {
      expect(blocks().map((block) => block.heading)).toEqual(['特定口座', 'NISA 成長投資枠'])
    })
    expect(screen.queryByText('7203')).toBeNull()
    expect(getPositions).toHaveBeenLastCalledWith({ data: { account: 'ALL', market: 'US' } })
    expect(router.state.location.search).toMatchObject({ market: 'US' })
    expect(screen.getByText('US stocks only — funds count as JP')).toBeTruthy()
  })

  it('leaves ALL out of the URL', async () => {
    const router = await renderAt('?market=US')
    await screen.findByRole('table')
    fireEvent.click(screen.getByRole('radio', { name: 'All', checked: false }))
    await waitFor(() => {
      expect(router.state.location.search).not.toHaveProperty('market')
    })
  })

  it.each([
    ['?scope=SPECIFIC&market=US', 'No open US positions in 特定.'],
    ['?scope=NISA&market=JP', 'No open JP positions in NISA.'],
    ['?scope=NISA', 'No open positions in NISA.'],
    ['?market=US', 'No open US positions.'],
    ['', 'No open positions.'],
  ])('names what the filters left out when %s is empty', async (search, message) => {
    serving([])
    await renderAt(search)
    expect(await screen.findByText(message)).toBeTruthy()
  })
})
