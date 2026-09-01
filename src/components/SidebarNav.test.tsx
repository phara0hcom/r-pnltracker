/**
 * The regression worth pinning is the collapsed rail's accessible names.
 *
 * Collapsing hides the labels. Removing them from the DOM looks equivalent and
 * is not: the tooltip is a *description*, wired up by Radix only while it is
 * open, so a link containing nothing but an `aria-hidden` icon has no name at
 * all — ten of them read as "link", "link", "link". `getByRole` with a name is
 * exactly the query that fails when that regresses.
 */
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { SidebarNav } from './SidebarNav'

const user = { id: 'u1', name: 'Tamer', email: 'tamer@example.com', image: null }

const ROUTES = [
  '/dashboard',
  '/trades',
  '/positions',
  '/dividends',
  '/calendar',
  '/stats',
  '/nisa',
  '/tax',
  '/import',
  '/settings',
]

/**
 * `Link` needs a router, and every `to` it renders must resolve to a real
 * route. The router resolves asynchronously — nothing is in the DOM on the
 * first tick — so every query below is a `find*`.
 */
function renderNav(collapsed: boolean) {
  const rootRoute = createRootRoute({
    component: () => <SidebarNav user={user} collapsed={collapsed} />,
  })
  rootRoute.addChildren(
    ROUTES.map((path) => createRoute({ getParentRoute: () => rootRoute, path })),
  )
  const router = createRouter({
    routeTree: rootRoute,
    history: createMemoryHistory({ initialEntries: ['/dashboard'] }),
  })
  return render(<RouterProvider router={router} />)
}

describe('SidebarNav', () => {
  it('names every link when expanded', async () => {
    renderNav(false)
    for (const name of ['Dashboard', 'Trades', 'Positions', 'Settings']) {
      expect(await screen.findByRole('link', { name })).toBeTruthy()
    }
  })

  it('still names every link when collapsed to the icon rail', async () => {
    renderNav(true)
    // The whole point: an icon-only rail must not be ten anonymous links.
    for (const name of ['Dashboard', 'Trades', 'Positions', 'Settings']) {
      expect(await screen.findByRole('link', { name })).toBeTruthy()
    }
  })

  it('names the sign-out button in both states', async () => {
    const { unmount } = renderNav(false)
    expect(await screen.findByRole('button', { name: 'Sign out' })).toBeTruthy()
    unmount()

    renderNav(true)
    expect(await screen.findByRole('button', { name: 'Sign out' })).toBeTruthy()
  })

  it('hides the labels visually on the rail without removing them', async () => {
    renderNav(true)
    const link = await screen.findByRole('link', { name: 'Positions' })
    const label = link.querySelector('span')
    expect(label?.textContent).toBe('Positions')
    // Present for assistive tech, invisible on screen.
    expect(label?.className).toContain('visually-hidden')
  })

  it('drops the user block on the rail, where there is no room for it', async () => {
    const { unmount } = renderNav(false)
    expect(await screen.findByText('tamer@example.com')).toBeTruthy()
    unmount()

    renderNav(true)
    await screen.findByRole('link', { name: 'Positions' })
    expect(screen.queryByText('tamer@example.com')).toBeNull()
  })
})
