/**
 * The Positions screen's blocks, as the page renders them.
 *
 * `getPositions` is stubbed with what the server builds minus the database and
 * the engine: the same scope test the engine's input goes through, and the
 * handler's own `positionsView` over hand-written rows. The stub answers
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
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { matchesAccountFilter, matchesMarketFilter } from '~/lib/domain/types'
import { positionsInput } from '~/lib/marketScope'
import { positionsView } from '~/lib/pnl/positionSummary'
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
  return {
    ...positionsView(rows, filters),
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

/** Every screen the sidebar links to; the others are empty stand-ins. */
const NAV_ROUTES = ['/dashboard', '/trades', '/exits', '/dividends', '/calendar', '/stats', '/nisa', '/tax', '/import', '/settings']

/**
 * The real Positions route under a bare root — or, `withNav`, under a root that
 * also renders the real sidebar, with the other screens it links to as empty
 * routes, so a test can leave Positions and come back the way a user does.
 */
async function renderAt(search: string, { withNav = false } = {}) {
  const { Route } = await import('~/routes/_authed/positions')
  const { SidebarNav } = await import('~/components/SidebarNav')
  const root = createRootRoute(
    withNav
      ? {
          component: () => (
            <>
              <SidebarNav user={{ id: 'u1', name: 'Owner', email: 'owner@example.com', image: null }} />
              <Outlet />
            </>
          ),
        }
      : {},
  )
  const positions = Route.update({
    id: '/_authed/positions',
    path: '/positions',
    getParentRoute: () => root,
  } as never)
  root.addChildren([
    positions,
    ...(withNav
      ? NAV_ROUTES.map((path) =>
          createRoute({ getParentRoute: () => root, path, component: () => <p>{`Screen ${path}`}</p> }),
        )
      : []),
  ])
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

interface Block {
  heading: string | null
  parts: { heading: string | null; symbols: (string | undefined)[] }[]
}

/**
 * Each block: its heading, then each part under it — a market's sub-heading
 * and the symbols beneath. Headings without their counts.
 */
const blocks = (): Block[] =>
  screen
    .getAllByRole('rowgroup')
    .filter((element) => element.tagName === 'TBODY')
    .map((body) => {
      const name = (tr: HTMLElement) => tr.querySelector('th')?.textContent?.replace(/\d+ positions?$/, '').trim() ?? null
      const block: Block = { heading: null, parts: [] }
      for (const tr of within(body).getAllByRole('row')) {
        if (tr.querySelector('th[scope="rowgroup"]')) block.heading = name(tr)
        else if (tr.querySelector('th[scope="row"]')) block.parts.push({ heading: name(tr), symbols: [] })
        else {
          if (block.parts.length === 0) block.parts.push({ heading: null, symbols: [] })
          block.parts.at(-1)?.symbols.push(BOOK.find((entry) => tr.textContent?.includes(entry.symbol))?.symbol)
        }
      }
      return block
    })

/** A block with no market parts, as `blocks()` reads it. */
const flat = (heading: string | null, symbols: string[]): Block => ({ heading, parts: [{ heading: null, symbols }] })

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
    window.sessionStorage.clear()
  })

  it('keeps each account together, with its JP and US holdings beneath it', async () => {
    await renderAt('')
    await screen.findByRole('table')
    // Accounts largest first (特定 ¥610k, NISA ¥500k), JP before US in each.
    expect(blocks()).toEqual([
      {
        heading: '特定口座',
        parts: [
          { heading: 'JP stocks & funds', symbols: ['7203'] },
          { heading: 'US stocks', symbols: ['NVDA'] },
        ],
      },
      {
        heading: 'NISA 成長投資枠',
        parts: [
          { heading: 'JP stocks & funds', symbols: ['8306'] },
          { heading: 'US stocks', symbols: ['VOO'] },
        ],
      },
    ])
    expect(getPositions).toHaveBeenCalledWith({ data: { account: 'ALL', market: 'ALL' } })
    expect(screen.getByRole('table').querySelector('caption')?.textContent).toMatch(/^Positions by account and market,/)
  })

  it('makes each market its own block under 特定', async () => {
    await renderAt('?scope=SPECIFIC')
    await screen.findByRole('table')
    expect(blocks()).toEqual([flat('JP stocks & funds', ['7203']), flat('US stocks', ['NVDA'])])
  })

  it('shows the accounts alone under one market', async () => {
    await renderAt('?market=US')
    await screen.findByRole('table')
    expect(blocks()).toEqual([flat('特定口座', ['NVDA']), flat('NISA 成長投資枠', ['VOO'])])
    expect(getPositions).toHaveBeenCalledWith({ data: { account: 'ALL', market: 'US' } })
  })

  it('shows one list with no heading when both filters are narrowed', async () => {
    await renderAt('?scope=SPECIFIC&market=JP')
    await screen.findByRole('table')
    expect(blocks()).toEqual([flat(null, ['7203'])])
    expect(screen.getByRole('table').querySelector('caption')?.textContent).toMatch(/^Positions, sorted by/)
  })

  it('puts no market heading in a book that holds one market', async () => {
    serving(BOOK.filter((entry) => entry.assetClass !== 'US_EQUITY'))
    await renderAt('')
    await screen.findByRole('table')
    expect(blocks()).toEqual([flat('NISA 成長投資枠', ['8306']), flat('特定口座', ['7203'])])
    // Read off the blocks, so it does not claim a market split the table lacks.
    expect(screen.getByRole('table').querySelector('caption')?.textContent).toMatch(/^Positions by account,/)
  })

  it('keeps a sort inside each market of each account', async () => {
    const book = [...BOOK, row('8411', { accountType: 'SPECIFIC', marketValueJpy: '900000', costShownJpy: '800000' })]
    serving(book)
    await renderAt('?sortBy=symbol&sortDir=asc')
    await screen.findByRole('table')
    const specific = blocks()[0]
    expect(specific?.heading).toBe('特定口座')
    // 8411 is not in BOOK, so the helper cannot name it — but it lands with 7203
    // under JP, sorted by symbol, and NVDA stays alone under US.
    expect(specific?.parts.map((part) => [part.heading, part.symbols.length])).toEqual([
      ['JP stocks & funds', 2],
      ['US stocks', 1],
    ])
  })

  it('cuts the phone card list into the same accounts and markets', async () => {
    mobile = true
    await renderAt('')
    const specific = await screen.findByRole('region', { name: '特定口座' })
    const specificUs = within(specific).getByRole('group', { name: '特定口座, US stocks' })
    expect(within(specificUs).getAllByRole('listitem').map((card) => card.textContent)).toEqual([
      expect.stringMatching(/^NVDA/),
    ])
    expect(screen.getByRole('group', { name: 'NISA 成長投資枠, JP stocks & funds' })).toBeTruthy()
    expect(screen.queryByRole('table')).toBeNull()
  })

  it('refetches for the market chosen, and writes it to the URL', async () => {
    const router = await renderAt('')
    await screen.findByRole('table')
    fireEvent.click(screen.getByRole('radio', { name: 'US' }))
    // Waits for the US book itself — its headings name accounts alone — rather
    // than for a row that was already on screen before the click.
    await waitFor(() => {
      expect(blocks()).toEqual([flat('特定口座', ['NVDA']), flat('NISA 成長投資枠', ['VOO'])])
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

describe('coming back to Positions', () => {
  beforeAll(() => {
    vi.stubGlobal('matchMedia', () => ({
      matches: false,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }))
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
    getPositions.mockReset()
    serving()
    window.sessionStorage.clear()
  })

  const link = (name: string) => screen.getByRole('link', { name })

  it('reopens on the market it was left on, from the sidebar', async () => {
    const router = await renderAt('?scope=NISA', { withNav: true })
    await screen.findByRole('table')
    fireEvent.click(screen.getByRole('radio', { name: 'US' }))
    await waitFor(() => {
      expect(router.state.location.search).toMatchObject({ market: 'US' })
    })

    // Away — the market is not part of another screen's URL…
    fireEvent.click(link('Dashboard'))
    await screen.findByText('Screen /dashboard')
    expect(router.state.location.search).not.toHaveProperty('market')
    // …but the link back carries it, beside the account switch.
    expect(link('Positions').getAttribute('href')).toBe('/positions?scope=NISA&market=US')
    expect(link('Trades').getAttribute('href')).toBe('/trades?scope=NISA')

    fireEvent.click(link('Positions'))
    // NISA is still split by account (it is three); the market is US alone.
    await waitFor(() => {
      expect(blocks()).toEqual([flat('NISA 成長投資枠', ['VOO'])])
    })
    expect(router.state.location.search).toMatchObject({ scope: 'NISA', market: 'US' })
    expect(getPositions).toHaveBeenLastCalledWith({ data: { account: 'NISA', market: 'US' } })
  })

  it('forgets the market once All is chosen again', async () => {
    await renderAt('?market=US', { withNav: true })
    await screen.findByRole('table')
    expect(link('Positions').getAttribute('href')).toBe('/positions?market=US')
    fireEvent.click(screen.getByRole('radio', { name: 'All', checked: false }))
    await waitFor(() => {
      expect(link('Positions').getAttribute('href')).toBe('/positions')
    })
  })

  it('reopens on the market with the browser’s Back as well', async () => {
    const router = await renderAt('', { withNav: true })
    await screen.findByRole('table')
    fireEvent.click(screen.getByRole('radio', { name: 'JP' }))
    await waitFor(() => {
      expect(router.state.location.search).toMatchObject({ market: 'JP' })
    })
    fireEvent.click(link('Stats'))
    await screen.findByText('Screen /stats')

    router.history.back()
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/positions')
    })
    expect(router.state.location.search).toMatchObject({ market: 'JP' })
    await waitFor(() => {
      // Largest first within JP: NISA's ¥300k ahead of 特定's ¥110k.
      expect(blocks()).toEqual([flat('NISA 成長投資枠', ['8306']), flat('特定口座', ['7203'])])
    })
  })
})
